#!/usr/bin/env node
/**
 * Puts each Apps Script project together in apps-script/<name>/ from src/: the library, the shared kit, the
 * template's own code and its dialog (with dialog.css and dialog.js inlined). Those folders are what you paste
 * into the Apps Script editor or push with clasp.
 *
 *   node tools/build.mjs          write apps-script/
 *   node tools/build.mjs --check  exit 1 when apps-script/ is not what src/ gives (the tests run this)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
export const OUT = join(ROOT, 'apps-script');

/** Each project: its title in Apps Script and its files, in the order Apps Script loads them. */
export const PROJECTS = {
  library: {
    title: 'SMSTunnel',
    files: ['library/SmsTunnel.js', 'library/Library.js'],
  },
  'forms-text-me': {
    title: 'SMSTunnel for Google Forms',
    container: 'forms',
    files: ['library/SmsTunnel.js', 'shared/SmsTunnelKit.js', 'projects/forms-text-me/Code.js', 'projects/forms-text-me/Setup.html'],
  },
  'sheets-status-texts': {
    title: 'SMSTunnel for Google Sheets: status texts',
    container: 'sheets',
    files: ['library/SmsTunnel.js', 'shared/SmsTunnelKit.js', 'projects/sheets-status-texts/Code.js', 'projects/sheets-status-texts/Setup.html'],
  },
  'sheets-reminders': {
    title: 'SMSTunnel for Google Sheets: appointment reminders',
    container: 'sheets',
    files: ['library/SmsTunnel.js', 'shared/SmsTunnelKit.js', 'projects/sheets-reminders/Code.js', 'projects/sheets-reminders/Setup.html'],
  },
  'calendar-reminders': {
    title: 'SMSTunnel for Google Calendar',
    container: 'sheets',
    files: ['library/SmsTunnel.js', 'shared/SmsTunnelKit.js', 'projects/calendar-reminders/Code.js', 'projects/calendar-reminders/Setup.html'],
  },
};

const CLASP_IGNORE = ['# clasp pushes only the project files', '**/**', '!appsscript.json', '!*.js', '!*.html', ''].join('\n');

function read(path) {
  return readFileSync(join(SRC, path), 'utf8').replace(/\r\n/g, '\n');
}

function inline(html) {
  return html.replace(/^([ \t]*)\/\* @include (dialog\.css|dialog\.js) \*\/\n/gm, (_, indent, file) =>
    read('shared/' + file)
      .trimEnd()
      .split('\n')
      .map((line) => (line ? indent + line : line))
      .join('\n') + '\n'
  );
}

/** The files of one project: {name: content}. */
export function buildProject(name) {
  const project = PROJECTS[name];
  if (!project) throw new Error('No project called ' + name);
  const files = {};
  for (const path of project.files) {
    const fileName = path.split('/').pop();
    files[fileName] = fileName.endsWith('.html') ? inline(read(path)) : read(path);
  }
  files['appsscript.json'] = read('projects/' + name + '/appsscript.json');
  const order = project.files.filter((path) => path.endsWith('.js')).map((path) => path.split('/').pop());
  files['.clasp.json.example'] =
    JSON.stringify({ scriptId: 'PASTE-THE-SCRIPT-ID-OF-' + name.toUpperCase(), rootDir: '.', filePushOrder: order }, null, 2) + '\n';
  files['.claspignore'] = CLASP_IGNORE;
  return files;
}

/** Builds every project; with check, compares instead of writing. Returns the paths that differ. */
export function buildAll({ check = false } = {}) {
  const differ = [];
  for (const name of Object.keys(PROJECTS)) {
    const dir = join(OUT, name);
    const files = buildProject(name);
    const present = existsSync(dir) ? readdirSync(dir) : [];
    for (const extra of present.filter((file) => !(file in files) && file !== '.clasp.json')) {
      differ.push(join(name, extra));
      if (!check) rmSync(join(dir, extra));
    }
    if (!check) mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      const path = join(dir, file);
      const now = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (now === content) continue;
      differ.push(join(name, file));
      if (!check) writeFileSync(path, content);
    }
  }
  return differ;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const differ = buildAll({ check });
  if (check && differ.length) {
    console.error('apps-script/ is not up to date with src/ (run npm run build):\n  ' + differ.join('\n  '));
    process.exit(1);
  }
  console.log(check ? 'apps-script/ is up to date.' : differ.length ? 'Wrote:\n  ' + differ.join('\n  ') : 'Nothing changed.');
}
