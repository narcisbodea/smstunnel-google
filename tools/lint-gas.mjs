#!/usr/bin/env node
/**
 * Checks that what we ship runs in Google Apps Script (V8 runtime) and keeps to our rules:
 *  - every .js file parses as a classic ES2019 script (no import/export, no ?. or ??, no class fields);
 *  - no Node or browser-only globals (fetch, setTimeout, URL, Buffer, require...), no async code, no newer
 *    built-ins (replaceAll, at, matchAll...), no look-behind or named groups in regular expressions;
 *  - top-level code is only declarations, so the order Apps Script loads the files in doesn't matter;
 *  - menu items, triggers and the dialogs' server calls name public functions (no trailing _) that exist;
 *  - dialog HTML: unique ids, every id the scripts use exists, no inline handlers, no innerHTML, no remote scripts;
 *  - manifests: V8 and exactly the scopes each project needs;
 *  - no API key is logged, and no public text uses the words our wording rules leave out.
 *
 *   node tools/lint-gas.mjs     prints the problems and exits 1 when there are any
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = (name) => 'https://www.googleapis.com/auth/' + name;

export const EXPECTED_SCOPES = {
  library: [SCOPE('script.external_request')],
  'forms-text-me': [SCOPE('forms.currentonly'), SCOPE('script.container.ui'), SCOPE('script.external_request'), SCOPE('script.scriptapp')],
  'sheets-status-texts': [SCOPE('spreadsheets.currentonly'), SCOPE('script.container.ui'), SCOPE('script.external_request'), SCOPE('script.scriptapp')],
  'sheets-reminders': [SCOPE('spreadsheets.currentonly'), SCOPE('script.container.ui'), SCOPE('script.external_request'), SCOPE('script.scriptapp')],
  'calendar-reminders': [
    SCOPE('calendar.readonly'),
    SCOPE('spreadsheets.currentonly'),
    SCOPE('script.container.ui'),
    SCOPE('script.external_request'),
    SCOPE('script.scriptapp'),
  ],
};

/** Globals that exist in Node or browsers but not in Apps Script, or that we keep out on purpose. */
const FORBIDDEN_GLOBALS = new Set([
  'require', 'module', 'exports', 'process', 'Buffer', '__dirname', '__filename', 'global', 'globalThis',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController',
  'atob', 'btoa', 'crypto', 'structuredClone', 'performance', 'Blob', 'FormData', 'Headers', 'Request', 'Response',
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'Intl', 'Promise', 'BigInt', 'WeakRef',
  'FinalizationRegistry', 'Atomics', 'SharedArrayBuffer',
]);

/** Methods newer than what we allow (ES2020+), as `.name(`. */
const FORBIDDEN_METHODS = new Set(['replaceAll', 'matchAll', 'at', 'findLast', 'findLastIndex', 'toSorted', 'toReversed', 'toSpliced', 'hasOwn', 'allSettled', 'any']);

/** Words our public texts leave out (Google Play policy for the app); built from parts so this file stays clean. */
const WORDING = new RegExp('\\b(' + ['gate' + 'way', 'bu' + 'lk', 'camp' + 'aign', 'market' + 'ing', 'ma' + 'ss'].join('|') + ')\\b', 'i');
const CONTROL = /\b(server|we|smstunnel)\s+controls?\s+(your|the)\s+phone/i;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function parse(code, file, problems) {
  try {
    return acorn.parse(code, { ecmaVersion: 2019, sourceType: 'script', locations: true });
  } catch (err) {
    problems.push(`${file}: does not parse as an ES2019 script (Apps Script V8): ${err.message}`);
    return null;
  }
}

/** Names declared anywhere in a file (so a local variable called, say, `global` doesn't count as the global). */
function declaredNames(ast) {
  const names = new Set();
  const addPattern = (node) => {
    if (!node) return;
    if (node.type === 'Identifier') names.add(node.name);
    else if (node.type === 'ObjectPattern') node.properties.forEach((p) => addPattern(p.value || p.argument));
    else if (node.type === 'ArrayPattern') node.elements.forEach(addPattern);
    else if (node.type === 'AssignmentPattern') addPattern(node.left);
    else if (node.type === 'RestElement') addPattern(node.argument);
  };
  walk.full(ast, (node) => {
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.id) names.add(node.id.name);
      node.params.forEach(addPattern);
    }
    if (node.type === 'CatchClause') addPattern(node.param);
    if (node.type === 'ClassDeclaration' && node.id) names.add(node.id.name);
  });
  return names;
}

/** Checks one script's code; `where` names it in messages. Returns the top-level function names. */
export function lintScript(code, where, problems, { topLevelOnlyDeclarations = true, browser = false } = {}) {
  const ast = parse(code, where, problems);
  if (!ast) return [];
  const declared = declaredNames(ast);
  const at = (node) => `${where}:${node.loc ? node.loc.start.line : '?'}`;

  const topFunctions = [];
  for (const statement of ast.body) {
    if (statement.type === 'FunctionDeclaration') topFunctions.push(statement.id.name);
    else if (statement.type === 'VariableDeclaration') continue;
    else if (topLevelOnlyDeclarations) problems.push(`${at(statement)}: top-level code other than declarations (${statement.type}) makes the files' load order matter`);
  }

  walk.fullAncestor(ast, (node, _state, ancestors) => {
    const parent = ancestors[ancestors.length - 2];
    if (node.type === 'Identifier' && !browser && FORBIDDEN_GLOBALS.has(node.name) && !declared.has(node.name)) {
      const isProperty = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const isKey = parent && parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand;
      if (!isProperty && !isKey) problems.push(`${at(node)}: ${node.name} does not exist in Apps Script`);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && FORBIDDEN_METHODS.has(node.property.name)) {
      if (parent && parent.type === 'CallExpression' && parent.callee === node) problems.push(`${at(node)}: .${node.property.name}() is newer than ES2019`);
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && (node.async || node.generator)) {
      problems.push(`${at(node)}: async functions and generators are left out (Apps Script runs scripts synchronously)`);
    }
    if (node.type === 'Literal' && node.regex) checkPattern(node.regex.pattern, at(node), problems);
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'RegExp' && node.arguments[0] && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string') {
      checkPattern(node.arguments[0].value, at(node), problems);
    }
    if (node.type === 'BinaryExpression' && node.operator === 'instanceof' && node.right.type === 'Identifier' && ['Date', 'Array', 'Object', 'Error'].includes(node.right.name)) {
      problems.push(`${at(node)}: instanceof ${node.right.name} depends on the realm; use Array.isArray or Object.prototype.toString`);
    }
    if (node.type === 'CallExpression' && isLogCall(node.callee)) {
      walk.full(node, (inner) => {
        const name = inner.type === 'Identifier' ? inner.name : inner.type === 'MemberExpression' && !inner.computed ? inner.property.name : '';
        if (/api_?key/i.test(name)) problems.push(`${at(node)}: a log call mentions ${name}; the API key is never logged`);
      });
    }
    if (browser && node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && !node.left.computed && ['innerHTML', 'outerHTML'].includes(node.left.property.name)) {
      problems.push(`${at(node)}: ${node.left.property.name} is left out (use textContent and createElement)`);
    }
  });
  return topFunctions;
}

function isLogCall(callee) {
  if (callee.type !== 'MemberExpression' || callee.computed) return false;
  const object = callee.object.type === 'Identifier' ? callee.object.name : '';
  return (object === 'console' && ['log', 'info', 'warn', 'error', 'debug'].includes(callee.property.name)) || (object === 'Logger' && callee.property.name === 'log');
}

function checkPattern(pattern, where, problems) {
  if (/\(\?<[=!]/.test(pattern)) problems.push(`${where}: look-behind in a regular expression (left out for older V8 builds)`);
  else if (/\(\?<[A-Za-z]/.test(pattern)) problems.push(`${where}: named group in a regular expression`);
  if (/\\[pP]\{/.test(pattern)) problems.push(`${where}: Unicode property escape in a regular expression`);
}

/**
 * Strings a call passes as its n-th argument, for calls of `name` (like addItem or newTrigger). With
 * literalOnly, other arguments (a variable in a helper) are skipped instead of reported.
 */
function stringArgs(code, where, callName, index, problems, literalOnly = false) {
  const ast = parse(code, where, problems);
  if (!ast) return [];
  const found = [];
  walk.full(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    const name = callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : callee.type === 'Identifier' ? callee.name : '';
    if (name !== callName) return;
    const arg = node.arguments[index];
    if (arg && arg.type === 'Literal' && typeof arg.value === 'string') found.push({ name: arg.value, line: node.loc.start.line });
    else if (arg && !literalOnly) problems.push(`${where}:${node.loc.start.line}: ${callName}() should name its function as a string literal`);
  });
  return found;
}

/** The strings in `handlers: [...]` arrays (each template's SMSTUNNEL_APP). */
function handlerLists(code, where, problems) {
  const ast = parse(code, where, problems);
  if (!ast) return [];
  const found = [];
  walk.full(ast, (node) => {
    if (node.type === 'Property' && !node.computed && node.key.type === 'Identifier' && node.key.name === 'handlers' && node.value.type === 'ArrayExpression') {
      node.value.elements.forEach((el) => {
        if (el && el.type === 'Literal' && typeof el.value === 'string') found.push({ name: el.value, line: el.loc.start.line });
      });
    }
  });
  return found;
}

function scriptsOf(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) scripts.push({ attrs: match[1], code: match[2], line: lineOf(html, match.index) });
  return scripts;
}

/** Checks one dialog: its scripts, ids and the server functions it calls. */
export function lintHtml(html, where, publicFunctions, problems) {
  const ids = [];
  const idPattern = /\sid="([^"]+)"/g;
  let match;
  while ((match = idPattern.exec(html)) !== null) ids.push(match[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${where}: the id "${id}" is used twice`);
    seen.add(id);
  }
  const forPattern = /\sfor="([^"]+)"/g;
  while ((match = forPattern.exec(html)) !== null) {
    if (!seen.has(match[1])) problems.push(`${where}:${lineOf(html, match.index)}: <label for="${match[1]}"> has no element with that id`);
  }
  if (/<script\b[^>]*\bsrc=/i.test(html)) problems.push(`${where}: loads a remote script`);
  const inlineHandler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(html);
  if (inlineHandler) problems.push(`${where}:${lineOf(html, inlineHandler.index)}: inline event handler attribute`);

  for (const script of scriptsOf(html)) {
    const label = `${where} (script at line ${script.line})`;
    lintScript(script.code, label, problems, { topLevelOnlyDeclarations: false, browser: true });
    // Every 'smstunnel…' string in a dialog script is a server function it calls (directly or through a helper).
    const serverNames = new Set();
    const astForNames = parse(script.code, label, problems);
    if (astForNames) {
      walk.full(astForNames, (node) => {
        if (node.type === 'Literal' && typeof node.value === 'string' && /^smstunnel[A-Z]\w*$/.test(node.value)) serverNames.add(node.value + ':' + node.loc.start.line);
      });
    }
    for (const entry of serverNames) {
      const [fn, line] = entry.split(':');
      if (!publicFunctions.includes(fn)) problems.push(`${label}:${line}: '${fn}' is not a public function of the project`);
    }
    for (const helper of ['byId', 'val', 'checked', 'set', 'check', 'show']) {
      for (const id of stringArgs(script.code, label, helper, 0, problems, true)) {
        if (!seen.has(id.name)) problems.push(`${label}:${id.line}: no element with id "${id.name}"`);
      }
    }
    if (/google\.script\.run\s*\.\s*(?!withSuccessHandler|withFailureHandler|withUserObject)[A-Za-z_$]/.test(script.code)) {
      problems.push(`${label}: calls google.script.run directly; go through callServer() so the lint can check the name`);
    }
  }
}

/** Checks one assembled project folder. */
export function lintProject(dir, name, problems) {
  const files = readdirSync(dir).filter((file) => statSync(join(dir, file)).isFile());
  const scripts = files.filter((file) => file.endsWith('.js'));
  const htmls = files.filter((file) => file.endsWith('.html'));
  const topFunctions = [];
  for (const file of scripts) {
    topFunctions.push(...lintScript(readFileSync(join(dir, file), 'utf8'), `${name}/${file}`, problems));
  }
  const dupes = topFunctions.filter((fn, i) => topFunctions.indexOf(fn) !== i);
  for (const fn of new Set(dupes)) problems.push(`${name}: the function ${fn} is declared in two files`);
  const publicFunctions = topFunctions.filter((fn) => !fn.endsWith('_'));

  for (const file of scripts) {
    const code = readFileSync(join(dir, file), 'utf8');
    const where = `${name}/${file}`;
    const handlers = [
      ...stringArgs(code, where, 'addItem', 1, problems).map((h) => ({ ...h, kind: 'menu item' })),
      ...stringArgs(code, where, 'newTrigger', 0, problems).map((h) => ({ ...h, kind: 'trigger' })),
      ...handlerLists(code, where, problems).map((h) => ({ ...h, kind: 'handler list' })),
    ];
    for (const handler of handlers) {
      if (handler.name.endsWith('_')) problems.push(`${where}:${handler.line}: ${handler.kind} ${handler.name} ends with _ (private functions can't be menu items or triggers)`);
      else if (!publicFunctions.includes(handler.name)) problems.push(`${where}:${handler.line}: ${handler.kind} ${handler.name} is not a function of the project`);
    }
  }
  for (const file of htmls) lintHtml(readFileSync(join(dir, file), 'utf8'), `${name}/${file}`, publicFunctions, problems);
  if (htmls.length && !scripts.some((file) => /HtmlService\.createHtmlOutputFromFile|showDialog\(/.test(readFileSync(join(dir, file), 'utf8')))) {
    problems.push(`${name}: has a dialog that nothing opens`);
  }

  const manifestPath = join(dir, 'appsscript.json');
  if (!existsSync(manifestPath)) problems.push(`${name}: no appsscript.json`);
  else {
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      problems.push(`${name}/appsscript.json: ${err.message}`);
    }
    if (manifest) {
      if (manifest.runtimeVersion !== 'V8') problems.push(`${name}/appsscript.json: runtimeVersion must be V8`);
      if (typeof manifest.timeZone !== 'string') problems.push(`${name}/appsscript.json: timeZone is missing`);
      if (manifest.exceptionLogging !== 'STACKDRIVER') problems.push(`${name}/appsscript.json: exceptionLogging should be STACKDRIVER`);
      const expected = EXPECTED_SCOPES[name];
      const scopes = manifest.oauthScopes || [];
      if (!expected) problems.push(`${name}: no expected scopes listed in the lint`);
      else if (JSON.stringify([...scopes].sort()) !== JSON.stringify([...expected].sort())) {
        problems.push(`${name}/appsscript.json: scopes ${JSON.stringify(scopes)} are not the expected ${JSON.stringify(expected)}`);
      }
      for (const key of Object.keys(manifest)) {
        if (!['timeZone', 'runtimeVersion', 'exceptionLogging', 'oauthScopes'].includes(key)) problems.push(`${name}/appsscript.json: unexpected key ${key}`);
      }
    }
  }
}

/** Public wording, and no key in any file of the repository. */
export function lintWording(root, problems) {
  const skip = new Set(['node_modules', '.git', 'package-lock.json']);
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(js|mjs|html|json|md|txt)$/.test(entry) || entry.startsWith('.')) {
        const text = readFileSync(path, 'utf8');
        const rel = relative(root, path).replace(/\\/g, '/');
        text.split('\n').forEach((line, i) => {
          const word = WORDING.exec(line);
          if (word) problems.push(`${rel}:${i + 1}: the word "${word[1]}" is left out of public texts`);
          if (CONTROL.test(line)) problems.push(`${rel}:${i + 1}: never imply that a server is in charge of the phone`);
          if (/sk_(live|test)_[A-Za-z0-9]{16,}/.test(line)) problems.push(`${rel}:${i + 1}: looks like a real API key`);
        });
      }
    }
  };
  visit(root);
}

export function lintAll(root = ROOT) {
  const problems = [];
  const out = join(root, 'apps-script');
  for (const name of readdirSync(out)) {
    if (statSync(join(out, name)).isDirectory()) lintProject(join(out, name), name, problems);
  }
  lintWording(root, problems);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintAll();
  if (problems.length) {
    console.error(problems.length + ' problem(s):\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('Lint: all Apps Script projects, dialogs, manifests and texts are fine.');
}
