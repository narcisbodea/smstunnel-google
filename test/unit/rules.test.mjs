import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi } from '../harness/gas.mjs';
import { serverRules } from '../harness/server-rules.mjs';

const gas = createGas({ project: 'library', http: fakeApi() });
const S = gas.global('SmsTunnel');
const server = serverRules();

/** A small seeded random generator, so a failing case can be repeated. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('sign-in codes: 4 to 10 digits standing on their own', () => {
  const yes = [
    '123456', 'Your code is 4829', 'Code:1234', 'G-123456', '12-345678', '123456 is your code', '123-456', 'Code (482913).',
    'code 0000000000', 'Your SMSTunnel code: 9182', '1234\n', 'é123456', 'Kod: 4821.', '2026', '1500 lei', '123-4567',
  ];
  const no = [
    '', 'Hello there', 'Your code is A1B2C3', 'ORD12345', 'Order 12345678901', 'Call +14155550123', 'Price 3.14159',
    'Due 01/11/2026', 'At 12:30', '123', 'abc123', '12-34', 'code_123456', '1234abc', '3,14159', 'x 1.2345', '1234/5',
    '123-456-789', '-123-456',
  ];
  for (const text of yes) test(`accepts ${JSON.stringify(text)}`, () => assert.equal(S.containsCode(text), true));
  for (const text of no) test(`refuses ${JSON.stringify(text)}`, () => assert.equal(S.containsCode(text), false));

  test('non-text is refused', () => {
    assert.equal(S.containsCode(123456), false);
    assert.equal(S.containsCode(null), false);
  });

  test('agrees with the server on every case above and 30,000 random texts', { skip: server ? false : 'the server source is not next to this repo' }, () => {
    for (const text of [...yes, ...no]) assert.equal(S.containsCode(text), server.containsSignInCode(text), JSON.stringify(text));
    const next = random(20261101);
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '4', '7', 'a', 'Z', '_', '+', '-', '.', ',', ':', '/', ' ', 'é', '\n', '😀'];
    for (let i = 0; i < 30000; i++) {
      let text = '';
      const length = Math.floor(next() * 22);
      for (let j = 0; j < length; j++) text += alphabet[Math.floor(next() * alphabet.length)];
      if (S.containsCode(text) !== server.containsSignInCode(text)) assert.fail('differs from the server for ' + JSON.stringify(text));
    }
  });
});

describe('phone numbers, read the way the server reads them', () => {
  const cases = [
    ['+1 (415) 555-0123', '', '+14155550123'],
    ['+40 722 123 456', '', '+40722123456'],
    ['0040722123456', '', '+40722123456'],
    ['0722 123 456', '+40', '+40722123456'],
    ['0722.123.456', '40', '+40722123456'],
    ['722123456', '+40', '+40722123456'],
    ['(415) 555-0123', '+1', '+14155550123'],
    [4155550123, '+1', '+14155550123'],
  ];
  for (const [value, cc, number] of cases) {
    test(`${JSON.stringify(value)} with ${cc || 'no country code'} → ${number}`, () => {
      const result = S.normalizePhone(value, cc);
      assert.equal(result.ok, true, result.message);
      assert.equal(result.number, number);
    });
  }

  const refused = [
    ['', '+1', 'EMPTY'],
    ['call me', '+1', 'NOT_A_NUMBER'],
    ['0722 123 456', '', 'NO_COUNTRY_CODE'],
    ['4155550123', '', 'NO_COUNTRY_CODE'],
    ['+1 415, +1 416', '', 'SEVERAL'],
    ['+123', '', 'NOT_A_NUMBER'],
    ['+1234567890123456', '', 'NOT_A_NUMBER'],
    ['+881612345678', '', 'BLOCKED'],
    ['+40 1234', '', 'NOT_A_NUMBER'],
    ['+4012345', '', 'BLOCKED'],
    ['+40 0900 123 456', '', 'BLOCKED'],
  ];
  for (const [value, cc, reason] of refused) {
    test(`refuses ${JSON.stringify(value)} (${reason})`, () => {
      const result = S.normalizePhone(value, cc);
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.ok(result.message.length > 10);
    });
  }

  test('a long value is quoted short in the reason', () => {
    const result = S.normalizePhone('call me at the office or on my mobile any time after nine', '+1');
    assert.equal(result.ok, false);
    assert.match(result.message, /^"call me at the office or on my mobile…" is not a phone number/);
  });

  test('country codes are cleaned like the server cleans them', () => {
    for (const [input, out] of [['+49', '+49'], ['49', '+49'], ['0049', '+49'], [' +1 ', '+1'], ['+1268', '+1268'], ['RO', null], ['+0', null], ['', null], ['12345', null], [40, '+40']]) {
      assert.equal(S.cleanCountryCode(input), out, String(input));
    }
  });

  test('agrees with the server on 20,000 random numbers', { skip: server ? false : 'the server source is not next to this repo' }, () => {
    const next = random(42);
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '7', '2', ' ', '-', '.', '(', ')', '+', 'a'];
    const prefixes = ['', '', '+', '00', '0', '+40', '+1', '+881', '+44 ', '0090'];
    const codes = ['+40', '+1', '+49', '+44', '+353'];
    for (let i = 0; i < 20000; i++) {
      let value = prefixes[Math.floor(next() * prefixes.length)];
      const length = 3 + Math.floor(next() * 14);
      for (let j = 0; j < length; j++) value += alphabet[Math.floor(next() * alphabet.length)];
      value = value.trim();
      const cc = codes[Math.floor(next() * codes.length)];
      const ours = S.normalizePhone(value, cc);
      const shapeOk = server.numberShape.test(value);
      const theirs = shapeOk ? server.normalizePhoneNumber(value, cc) : { isValid: false };
      if (ours.ok !== theirs.isValid || (ours.ok && ours.number !== theirs.normalized)) {
        assert.fail(`differs from the server for ${JSON.stringify(value)} with ${cc}: ours ${JSON.stringify(ours)}, server ${JSON.stringify(theirs)}`);
      }
    }
    for (const value of ['+49', '49', '0049', ' +1 ', '+1268', 'RO', '+0', '', '12345', '0', '00', '+']) {
      assert.equal(S.cleanCountryCode(value), server.cleanCountryCode(value) ?? null, value);
    }
  });
});
