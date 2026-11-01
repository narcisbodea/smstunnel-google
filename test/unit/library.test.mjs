import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi } from '../harness/gas.mjs';

const KEY = 'sk_live_unit-test-key-0001';

function lib(http, { key = KEY, ...options } = {}) {
  const gas = createGas({ project: 'library', http, ...options });
  if (key) gas.useKey(key);
  return { gas, S: gas.global('SmsTunnel') };
}

function caught(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected an error');
}

describe('sendSms', () => {
  test('posts one text with the key header and returns the message id', () => {
    const api = fakeApi();
    const { gas, S } = lib(api);
    const result = S.sendSms('+14155550123', 'Your order has shipped.');
    assert.equal(result.success, true);
    assert.equal(result.messageId, 'msg0001');
    assert.equal(result.queued, false);
    assert.equal(result.branded, false);
    assert.deepEqual(JSON.parse(JSON.stringify(result.remaining)), { clean: 99, total: 'unlimited' });
    const [request] = gas.requests;
    assert.equal(request.url, 'https://smstunnel.io/api/v1/sms/send');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['X-API-Key'], KEY);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.equal(request.headers.Accept, 'application/json');
    assert.equal(request.params.muteHttpExceptions, true);
    assert.equal(request.params.followRedirects, false);
    assert.deepEqual(JSON.parse(request.payload), { to: '+14155550123', message: 'Your order has shipped.' });
  });

  test('says when the phone was offline and the text waits', () => {
    const { S } = lib(() => ({ status: 200, body: { success: true, messageId: 'm1', queued: true, data: { messageId: 'm1', branded: true, queued: true, remaining: {} } } }));
    const result = S.sendSms('+14155550123', 'Hi');
    assert.equal(result.queued, true);
    assert.equal(result.branded, true);
  });

  test('passes deviceId, a cleaned defaultCountryCode, serverUrl and apiKey', () => {
    const api = fakeApi();
    const { gas, S } = lib(api, { key: null });
    S.sendSms('0722 123 456', 'Hi', { deviceId: '6ae660e96609f21a1184a210', defaultCountryCode: '0040', serverUrl: 'https://example.test/', apiKey: 'sk_live_from-options-01' });
    const [request] = gas.requests;
    assert.equal(request.url, 'https://example.test/api/v1/sms/send');
    assert.equal(request.headers['X-API-Key'], 'sk_live_from-options-01');
    assert.deepEqual(JSON.parse(request.payload), { to: '0722 123 456', message: 'Hi', deviceId: '6ae660e96609f21a1184a210', defaultCountryCode: '+40' });
  });

  test('refuses an unknown option, a bad country code and a bad phone id before any request', () => {
    const { gas, S } = lib(fakeApi());
    assert.equal(caught(() => S.sendSms('+14155550123', 'Hi', { deviceID: 'x' })).code, 'INVALID_ARGUMENT');
    assert.match(caught(() => S.sendSms('+14155550123', 'Hi', { deviceID: 'x' })).message, /Unknown option "deviceID"/);
    assert.equal(caught(() => S.sendSms('+14155550123', 'Hi', { defaultCountryCode: 'RO' })).code, 'INVALID_ARGUMENT');
    assert.equal(caught(() => S.sendSms('+14155550123', 'Hi', { deviceId: 'not a phone id!' })).code, 'INVALID_ARGUMENT');
    assert.equal(caught(() => S.sendSms('+14155550123', 'Hi', 'nope')).code, 'INVALID_ARGUMENT');
    assert.equal(gas.requests.length, 0);
  });

  test('one recipient per call: lists of numbers are refused', () => {
    const { gas, S } = lib(fakeApi());
    for (const to of [['+14155550123', '+14155550124'], '+14155550123, +14155550124', '+14155550123;+14155550124', '+14155550123\n+14155550124']) {
      const err = caught(() => S.sendSms(to, 'Hi'));
      assert.equal(err.code, 'INVALID_NUMBER');
      assert.match(err.message, /one number per text/i);
    }
    assert.equal(gas.requests.length, 0);
  });

  test('numbers: empty, words and short ones are refused; a number cell value is fine', () => {
    const api = fakeApi();
    const { S } = lib(api);
    for (const to of ['', '   ', null, undefined, 'call me', '12345', '+1 (415) 555-0123 ext 9']) {
      assert.equal(caught(() => S.sendSms(to, 'Hi')).code, 'INVALID_NUMBER', String(to));
    }
    S.sendSms(14155550123, 'Hi');
    assert.equal(api.sent[0].to, '14155550123');
  });

  test('the text: empty is refused, 1600 characters go, 1601 do not, and an emoji counts once', () => {
    const api = fakeApi();
    const { S } = lib(api);
    assert.equal(caught(() => S.sendSms('+14155550123', '   ')).code, 'INVALID_ARGUMENT');
    S.sendSms('+14155550123', 'x'.repeat(1600));
    const err = caught(() => S.sendSms('+14155550123', 'x'.repeat(1601)));
    assert.equal(err.code, 'MESSAGE_TOO_LONG');
    assert.match(err.message, /1601 characters/);
    S.sendSms('+14155550123', '😀'.repeat(1600));
    assert.equal(S.textLength('😀'), 1);
    assert.equal(S.textLength('❤️'), 1);
    assert.equal(api.sent.length, 2);
  });
});

describe('the key and the server', () => {
  test('options.apiKey wins, then user properties, then script properties', () => {
    const { gas, S } = lib(fakeApi(), { key: null });
    gas.scriptProps.setProperty('SMSTUNNEL_API_KEY', 'sk_live_script-key-01');
    S.sendSms('+14155550123', 'a');
    gas.userProps.setProperty('SMSTUNNEL_API_KEY', 'sk_live_user-key-01');
    S.sendSms('+14155550123', 'b');
    S.sendSms('+14155550123', 'c', { apiKey: 'sk_live_option-key-01' });
    assert.deepEqual(
      gas.requests.map((r) => r.headers['X-API-Key']),
      ['sk_live_script-key-01', 'sk_live_user-key-01', 'sk_live_option-key-01']
    );
  });

  test('no key: NO_API_KEY, and nothing is sent', () => {
    const { gas, S } = lib(fakeApi(), { key: null });
    const err = caught(() => S.sendSms('+14155550123', 'Hi'));
    assert.equal(err.code, 'NO_API_KEY');
    assert.match(err.message, /Apps → Add an app/);
    assert.equal(gas.requests.length, 0);
  });

  test('setApiKey, hasApiKey, apiKeyHint and clearApiKey keep the key in user properties by default', () => {
    const { gas, S } = lib(fakeApi(), { key: null });
    assert.equal(S.hasApiKey(), false);
    S.setApiKey('  sk_live_saved-key-9876  ');
    assert.equal(gas.userProps.getProperty('SMSTUNNEL_API_KEY'), 'sk_live_saved-key-9876');
    assert.equal(gas.scriptProps.getProperty('SMSTUNNEL_API_KEY'), null);
    assert.equal(S.hasApiKey(), true);
    assert.equal(S.apiKeyHint(), '…9876');
    S.setApiKey('sk_live_shared-key-1111', 'script');
    assert.equal(gas.scriptProps.getProperty('SMSTUNNEL_API_KEY'), 'sk_live_shared-key-1111');
    S.clearApiKey();
    assert.equal(S.apiKeyHint(), '…1111');
    S.clearApiKey('script');
    assert.equal(S.hasApiKey(), false);
    assert.equal(caught(() => S.setApiKey('has spaces inside')).code, 'INVALID_ARGUMENT');
    assert.equal(caught(() => S.setApiKey('')).code, 'INVALID_ARGUMENT');
    assert.equal(caught(() => S.setApiKey('sk_live_ok-key-0001', 'document')).code, 'INVALID_ARGUMENT');
  });

  test('the server URL must be https (or a local test server) and may come from a property', () => {
    const { gas, S } = lib(fakeApi());
    assert.equal(caught(() => S.sendSms('+14155550123', 'Hi', { serverUrl: 'http://example.com' })).code, 'INVALID_ARGUMENT');
    assert.equal(caught(() => S.sendSms('+14155550123', 'Hi', { serverUrl: 'ftp://example.com' })).code, 'INVALID_ARGUMENT');
    gas.userProps.setProperty('SMSTUNNEL_SERVER_URL', 'http://127.0.0.1:3101/');
    S.sendSms('+14155550123', 'Hi');
    assert.equal(gas.requests[0].url, 'http://127.0.0.1:3101/api/v1/sms/send');
  });
});

describe('sendCode', () => {
  test('posts to /api/v1/sms/send-2fa', () => {
    const api = fakeApi();
    const { gas, S } = lib(api);
    S.sendCode('+14155550123', 'Your code is 482913', { deviceId: 'abc123' });
    assert.equal(gas.requests[0].url, 'https://smstunnel.io/api/v1/sms/send-2fa');
    assert.deepEqual(api.sent[0], { to: '+14155550123', message: 'Your code is 482913', deviceId: 'abc123', path: '/api/v1/sms/send-2fa', id: 'msg0001' });
  });

  test('refuses texts without a code of 4 to 10 digits, and over 320 characters, without a request', () => {
    const { gas, S } = lib(fakeApi());
    for (const text of ['Your code is A1B2C3', 'Hello there', 'Code 12345678901', 'Call +14155550123', 'Due 01/11/2026']) {
      const err = caught(() => S.sendCode('+14155550123', text));
      assert.equal(err.code, 'NO_CODE', text);
      assert.match(err.message, /No valid verification code found/);
    }
    assert.equal(caught(() => S.sendCode('+14155550123', 'Code 123456 ' + 'x'.repeat(320))).code, 'MESSAGE_TOO_LONG');
    assert.equal(gas.requests.length, 0);
  });
});

describe('errors', () => {
  const cases = [
    [400, { message: ['to must be a phone number', 'message should not be empty'], error: 'Bad Request', statusCode: 400 }, {}, 'BAD_REQUEST', false, /to must be a phone number; message should not be empty/],
    [401, { message: 'Invalid or expired API key', error: 'Unauthorized', statusCode: 401 }, {}, 'UNAUTHORIZED', false, /Invalid or expired API key/],
    [403, { message: 'This API key needs sms:read', code: 'PERMISSION_REQUIRED', permission: 'sms:read', statusCode: 403 }, {}, 'PERMISSION_REQUIRED', false, /needs sms:read/],
    [403, { message: 'Plan limit reached', error: 'Forbidden', statusCode: 403 }, {}, 'FORBIDDEN', false, /Plan limit/],
    [404, { message: 'Message not found', error: 'Not Found', statusCode: 404 }, {}, 'NOT_FOUND', false, /Message not found/],
    [429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, { 'Retry-After': '30' }, 'RATE_LIMITED', true, /Too Many Requests/],
    [500, { statusCode: 500, message: 'Internal server error' }, {}, 'SERVER_ERROR', true, /Internal server error/],
    [502, '<html><body><h1>502 Bad Gate' + 'way</h1></body></html>', {}, 'SERVER_ERROR', true, /^SMSTunnel: 502 Bad/],
    [418, '', {}, 'HTTP_ERROR', false, /request failed with status 418/],
  ];
  for (const [status, body, headers, code, retryable, message] of cases) {
    test(`${status} → ${code}${retryable ? ' (retryable)' : ''}`, () => {
      const { S } = lib(() => ({ status, body, headers }));
      const err = caught(() => S.sendSms('+14155550123', 'Hi'));
      assert.equal(err.name, 'SmsTunnelError');
      assert.equal(err.status, status);
      assert.equal(err.code, code);
      assert.equal(err.retryable, retryable);
      assert.equal(S.isRetryable(err), retryable);
      assert.match(err.message, message);
      assert.match(err.message, /^SMSTunnel: /);
      if (code === 'PERMISSION_REQUIRED') assert.equal(err.permission, 'sms:read');
      if (status === 429) assert.equal(err.retryAfter, 30);
    });
  }

  test('a redirect is not followed (the key stays with SMSTunnel)', () => {
    const { S } = lib(() => ({ status: 302, headers: { Location: 'https://elsewhere.test/api/v1/sms/send' }, body: '' }));
    const err = caught(() => S.sendSms('+14155550123', 'Hi'));
    assert.equal(err.code, 'REDIRECT');
    assert.match(err.message, /redirect to https:\/\/elsewhere\.test/);
  });

  test('no answer at all → NETWORK_ERROR, retryable, and the key never shows in the message', () => {
    const { S } = lib(() => ({ throw: 'Address unavailable: https://smstunnel.io/api/v1/sms/send?k=' + KEY }));
    const err = caught(() => S.sendSms('+14155550123', 'Hi'));
    assert.equal(err.code, 'NETWORK_ERROR');
    assert.equal(err.retryable, true);
    assert.equal(err.status, 0);
    assert.equal(err.message.includes(KEY), false);
    assert.match(err.message, /\[key\]/);
  });

  test('2xx answers that are not what we expect', () => {
    assert.equal(caught(() => lib(() => ({ status: 200, body: 'OK' })).S.sendSms('+14155550123', 'Hi')).code, 'INVALID_RESPONSE');
    assert.equal(caught(() => lib(() => ({ status: 200, body: { success: true } })).S.sendSms('+14155550123', 'Hi')).code, 'INVALID_RESPONSE');
    const err = caught(() => lib(() => ({ status: 200, body: { success: false, error: 'No phone' } })).S.sendSms('+14155550123', 'Hi'));
    assert.equal(err.status, 200);
    assert.match(err.message, /No phone/);
  });
});

describe('getStatus, getPhones, getUsage', () => {
  test('getStatus encodes the id and returns the data', () => {
    const { gas, S } = lib(fakeApi());
    const status = S.getStatus(' a/b ');
    assert.equal(gas.requests[0].url, 'https://smstunnel.io/api/v1/sms/status/a%2Fb');
    assert.equal(gas.requests[0].method, 'GET');
    assert.equal(gas.requests[0].payload, undefined);
    assert.equal(status.status, 'sent');
    assert.equal(caught(() => S.getStatus('')).code, 'INVALID_ARGUMENT');
  });

  test('getPhones lists the phones', () => {
    const { S } = lib(fakeApi({ phones: [{ id: 'p1', name: 'Store phone', isOnline: true, lastSeenAt: 'x' }, { id: 'p2', isOnline: false }] }));
    assert.deepEqual(JSON.parse(JSON.stringify(S.getPhones())), [
      { id: 'p1', name: 'Store phone', isOnline: true, lastSeenAt: 'x' },
      { id: 'p2', name: '', isOnline: false, lastSeenAt: null },
    ]);
  });

  test('getUsage returns the data', () => {
    const { S } = lib(fakeApi());
    assert.equal(S.getUsage().plan, 'pro');
  });
});

describe('the library project', () => {
  test('its top-level functions hand over to SmsTunnel (what SmsTunnel.sendSms is for library users)', () => {
    const api = fakeApi();
    const { gas } = lib(api);
    assert.equal(gas.run('sendSms', '+14155550123', 'Hi').messageId, 'msg0001');
    assert.equal(gas.run('sendCode', '+14155550123', 'Code 123-456').messageId, 'msg0002');
    assert.equal(gas.run('getStatus', 'msg0001').status, 'sent');
    assert.equal(gas.run('getPhones').length, 1);
    assert.equal(gas.run('containsCode', 'Code 4821'), true);
    assert.equal(gas.run('normalizePhone', '(415) 555-0123', '+1').number, '+14155550123');
    assert.equal(gas.run('cleanCountryCode', '0049'), '+49');
    assert.equal(gas.run('version'), '1.0.0');
    gas.run('setApiKey', 'sk_live_wrapper-key-77');
    assert.equal(gas.run('apiKeyHint'), '…y-77');
    assert.equal(gas.run('hasApiKey'), true);
    gas.run('clearApiKey');
    assert.equal(gas.run('hasApiKey'), false);
  });

  test('loads in either file order', () => {
    const { S } = lib(fakeApi(), { reverseLoad: true });
    assert.equal(S.sendSms('+14155550123', 'Hi').messageId, 'msg0001');
  });

  test('the SmsTunnel object is frozen and keeps its helpers private', () => {
    const { S } = lib(fakeApi());
    assert.equal(Object.isFrozen(S), true);
    assert.equal(S.call, undefined);
    assert.equal(S.fail, undefined);
  });
});
