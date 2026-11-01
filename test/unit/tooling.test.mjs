import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAll, buildProject, PROJECTS, ROOT } from '../../tools/build.mjs';
import { EXPECTED_SCOPES, lintAll, lintHtml, lintProject, lintScript } from '../../tools/lint-gas.mjs';

const TMP = join(ROOT, 'test', '.tmp');
after(() => rmSync(TMP, { recursive: true, force: true }));

describe('build', () => {
  test('apps-script/ is exactly what src/ builds', () => {
    assert.deepEqual(buildAll({ check: true }), []);
  });

  test('every template carries the library and the kit, and its dialog has the shared parts inlined', () => {
    for (const name of Object.keys(PROJECTS)) {
      const files = buildProject(name);
      assert.ok(files['SmsTunnel.js'].includes('const SmsTunnel = (function'), name);
      assert.ok(files['appsscript.json'] && files['.clasp.json.example'] && files['.claspignore'], name);
      if (name === 'library') continue;
      assert.ok(files['SmsTunnelKit.js'], name);
      assert.ok(!files['Setup.html'].includes('@include'), name);
      assert.ok(files['Setup.html'].includes('var Dialog = (function'), name);
      const clasp = JSON.parse(files['.clasp.json.example']);
      assert.match(clasp.scriptId, /^PASTE-THE-SCRIPT-ID/);
      assert.deepEqual(clasp.filePushOrder, ['SmsTunnel.js', 'SmsTunnelKit.js', 'Code.js']);
    }
  });
});

describe('lint', () => {
  test('finds nothing in what we ship', () => {
    assert.deepEqual(lintAll(), []);
  });

  test('catches what Apps Script V8 cannot run, and what we keep out', () => {
    const bad = {
      'optional chaining': 'function f(a) { return a?.b; }',
      'nullish coalescing': 'function f(a) { return a ?? 1; }',
      'class field': 'class A { x = 1; }',
      import: 'import x from "y";',
      fetch: 'function f() { return fetch("https://x.test"); }',
      setTimeout: 'function f() { setTimeout(function () {}, 1); }',
      URL: 'function f() { return new URL("https://x.test"); }',
      URLSearchParams: 'function f() { return new URLSearchParams("a=1"); }',
      require: 'var fs = require("fs");',
      Buffer: 'function f() { return Buffer.from("x"); }',
      Promise: 'function f() { return Promise.resolve(1); }',
      async: 'async function f() {}',
      generator: 'function* f() {}',
      replaceAll: 'function f(s) { return s.replaceAll("a", "b"); }',
      at: 'function f(a) { return a.at(-1); }',
      'look-behind': 'var r = /(?<!a)b/;',
      'look-behind in new RegExp': 'var r = new RegExp("(?<=a)b");',
      'named group': 'var r = /(?<year>\\d{4})/;',
      'top-level call': 'doSomething();',
      'logging a key': 'function f(apiKey) { console.log("key", apiKey); }',
      'logging a key property': 'function f(o) { Logger.log(o.apiKey); }',
      'instanceof Date': 'function f(d) { return d instanceof Date; }',
    };
    for (const [what, code] of Object.entries(bad)) {
      const problems = [];
      lintScript(code, what, problems);
      assert.ok(problems.length > 0, 'the lint should refuse: ' + what);
    }
    const fine = [];
    lintScript('var A = (function () { var x = { at: 1, fetch: 2 }; return x.at + x.fetch; })(); function f(map) { return map.fetch; }', 'fine', fine);
    assert.deepEqual(fine, []);
  });

  test('checks the dialogs: ids, labels, server calls, no innerHTML, no inline handlers, no remote scripts', () => {
    const html = `<label for="a">A</label><input id="a"><input id="a"><label for="ghost">G</label>
<button onclick="go()">x</button><script src="https://cdn.test/x.js"></script>
<script>Dialog.byId('nope'); Dialog.callServer('smstunnelMissing'); document.body.innerHTML = '<b>x</b>'; google.script.run.smstunnelSave();</script>`;
    const problems = [];
    lintHtml(html, 'Setup.html', ['smstunnelSave'], problems);
    const text = problems.join('\n');
    for (const expected of [/"a" is used twice/, /for="ghost"/, /inline event handler/, /remote script/, /id "nope"/, /'smstunnelMissing' is not a public function/, /innerHTML/, /calls google\.script\.run directly/]) {
      assert.match(text, expected);
    }
  });

  test('menu items and triggers must name public functions that exist', () => {
    const dir = join(TMP, 'bad-project');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'Code.js'),
      `var APP = { handlers: ['smstunnelGone'] };
function onOpen() { SpreadsheetApp.getUi().createMenu('X').addItem('Run', 'secret_').addItem('Other', 'missing').addToUi(); }
function secret_() {}
function install() { ScriptApp.newTrigger('nowhere').timeBased().everyHours(1).create(); }`
    );
    writeFileSync(join(dir, 'appsscript.json'), JSON.stringify({ timeZone: 'Etc/UTC', runtimeVersion: 'DEPRECATED_ES5', oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'] }));
    const problems = [];
    lintProject(dir, 'sheets-reminders', problems);
    const text = problems.join('\n');
    for (const expected of [/secret_ ends with _/, /menu item missing is not a function/, /trigger nowhere is not a function/, /handler list smstunnelGone/, /runtimeVersion must be V8/, /scopes .* are not the expected/]) {
      assert.match(text, expected);
    }
  });
});

describe('dialog previews', () => {
  test('the dialogs fill {placeholders} exactly like the script that sends the texts', async () => {
    const vm = await import('node:vm');
    const { createGas, fakeApi } = await import('../harness/gas.mjs');
    const html = readFileSync(join(ROOT, 'apps-script', 'sheets-status-texts', 'Setup.html'), 'utf8');
    const dialogJs = html.match(/<script>\s*(\/\* The parts every SMSTunnel setup dialog shares[\s\S]*?)<\/script>/)[1];
    const context = vm.createContext({ document: {}, google: {} });
    vm.runInContext(dialogJs, context);
    const dialog = vm.runInContext('Dialog', context);
    const kit = createGas({ project: 'sheets-status-texts', http: fakeApi(), spreadsheet: { sheets: [{ name: 'S' }] } }).global('SmsTunnelKit');
    const values = { name: '', order: 'A-1', status: 'Shipped', amount: '$& 5' };
    for (const template of ['Hi {Name}, order {Order} is {Status}.', 'Hi {Name}', '{Name}!', 'Hi {{ name }} and {Nope}', 'Total {Amount} ({Name})', '{ORDER}{order}', 'No placeholders']) {
      assert.equal(dialog.fill(template, values), kit.fill(template, values).text, template);
    }
  });
});

describe('manifests', () => {
  test('each project asks only for what it uses', () => {
    for (const name of Object.keys(PROJECTS)) {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'apps-script', name, 'appsscript.json'), 'utf8'));
      assert.deepEqual([...manifest.oauthScopes].sort(), [...EXPECTED_SCOPES[name]].sort(), name);
      assert.equal(manifest.runtimeVersion, 'V8');
      for (const scope of manifest.oauthScopes) {
        assert.ok(!/\/auth\/(spreadsheets|forms|calendar|drive|documents)$/.test(scope), name + ' asks for a broad scope: ' + scope);
      }
      const hasCalendar = manifest.oauthScopes.some((scope) => scope.includes('calendar'));
      assert.equal(hasCalendar, name === 'calendar-reminders', name);
    }
  });
});
