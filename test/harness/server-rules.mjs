/**
 * The SMSTunnel server's own rules for sign-in codes and phone numbers, read from its source next to this repo
 * (D:/ANDROID/SMSserver, or SMSTUNNEL_SERVER_SRC), so the tests can compare our copies with them.
 * Returns null when the server source isn't there; the comparisons are then skipped.
 *
 * The two files are plain TypeScript with no imports. They are transpiled with the server's own TypeScript and
 * run in a separate vm context: this evaluates our own server code, for the tests only.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SERVER = process.env.SMSTUNNEL_SERVER_SRC || 'D:/ANDROID/SMSserver';

function load(file) {
  const path = join(SERVER, 'src/utils', file);
  const tsPath = join(SERVER, 'node_modules/typescript');
  if (!existsSync(path) || !existsSync(tsPath)) return null;
  const ts = createRequire(join(SERVER, 'package.json'))('typescript');
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: () => ({}) }, { filename: path });
  return module.exports;
}

export function serverRules() {
  const codes = load('sign-in-code.util.ts');
  const phones = load('phone-number.util.ts');
  if (!codes || !phones || typeof codes.containsSignInCode !== 'function' || typeof phones.normalizePhoneNumber !== 'function') return null;
  return {
    containsSignInCode: codes.containsSignInCode,
    normalizePhoneNumber: phones.normalizePhoneNumber,
    cleanCountryCode: phones.cleanCountryCode,
    /** The server's check on `to` before it reads the number (SendSmsDto). */
    numberShape: /^[\d\s.\-()+ ]{7,25}$/,
  };
}
