import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi } from '../harness/gas.mjs';

const KEY = 'sk_live_kit-test-key-0042';

function sheetGas(http = fakeApi(), extra = {}) {
  const gas = createGas({ project: 'sheets-status-texts', http, spreadsheet: { name: 'Orders 2026', sheets: [{ name: 'Orders', rows: [['Name', 'Phone', 'Status']] }] }, ...extra });
  return { gas, K: gas.global('SmsTunnelKit'), S: gas.global('SmsTunnel'), app: gas.global('SMSTUNNEL_APP') };
}

describe('texts with {placeholders}', () => {
  const { K } = sheetGas();
  test('fills names without minding case or spaces, and {{double}} braces', () => {
    const values = K.valuesFrom(['Name', 'Order  No', 'Status'], ['Ana', 'A-17', 'Shipped']);
    assert.deepEqual(JSON.parse(JSON.stringify(K.fill('Hi {name}, order {Order No} is {{ STATUS }}.', values))), { text: 'Hi Ana, order A-17 is Shipped.', missing: [] });
  });
  test('reports unknown names and leaves them in place', () => {
    const out = K.fill('Hi {Nmae}', K.valuesFrom(['Name'], ['Ana']));
    assert.equal(out.text, 'Hi {Nmae}');
    assert.deepEqual([...out.missing], ['Nmae']);
    assert.deepEqual([...K.unknownPlaceholders('{Name} {Order} {name}', ['name'])], ['Order']);
    assert.deepEqual([...K.placeholders('{A} {{B}} {A} {}')], ['A', 'B']);
  });
  test('an empty value takes the space before it when punctuation follows', () => {
    const values = K.valuesFrom(['Name', 'Order'], ['', 'A-1']);
    assert.equal(K.fill('Hi {Name}, order {Order} is ready.', values).text, 'Hi, order A-1 is ready.');
    assert.equal(K.fill('Hi {Name}', values).text, 'Hi');
    assert.equal(K.fill('Hi {Name} and welcome', values).text, 'Hi and welcome');
    assert.equal(K.fill('{Name}!', values).text, '!');
  });
  test('a value with $ signs is put in as it is', () => {
    assert.equal(K.fill('Total {Amount}', K.valuesFrom(['Amount'], ['$& $1 $$'])).text, 'Total $& $1 $$');
  });
  test('truncate counts like SMSTunnel and never splits an emoji', () => {
    assert.equal(K.truncate('short', 1600), 'short');
    const cut = K.truncate('😀'.repeat(10), 5);
    assert.equal(cut.endsWith('…'), true);
    assert.ok(!/[\uD800-\uDBFF]…$/.test(cut));
    assert.ok(K.truncate('x'.repeat(2000), 1600).length <= 1600);
  });
});

describe('cells and numbers', () => {
  const { K } = sheetGas();
  test('what we write to a cell never becomes a formula or a number', () => {
    assert.equal(K.safeCell('=IMPORTXML("https://evil.test", "//a")'), '\'=IMPORTXML("https://evil.test", "//a")');
    assert.equal(K.safeCell('+14155550123'), "'+14155550123");
    assert.equal(K.safeCell('-5'), "'-5");
    assert.equal(K.safeCell('@here'), "'@here");
    assert.equal(K.safeCell('Sent'), 'Sent');
    assert.equal(K.safeCell(42), 42);
  });
  test('a number cell that lost its + to Google Sheets is read as international when it carries the country code', () => {
    assert.equal(K.phoneFromCell(14155550123, '14155550123', '+1').number, '+14155550123');
    assert.equal(K.phoneFromCell(40722123456, '40722123456', '+40').number, '+40722123456');
    assert.equal(K.phoneFromCell(4155550123, '4155550123', '+1').number, '+14155550123');
    assert.equal(K.phoneFromCell(722123456, '722123456', '+40').number, '+40722123456');
    assert.equal(K.phoneFromCell(14155550123, '+1 415-555-0123', '').number, '+14155550123');
    assert.equal(K.phoneFromCell('+1 (415) 555-0123', '+1 (415) 555-0123', '').number, '+14155550123');
    assert.equal(K.phoneFromCell(4155550123, '4155550123', '').reason, 'NO_COUNTRY_CODE');
    assert.equal(K.phoneFromCell('', '', '+1').reason, 'EMPTY');
  });
  test('your own numbers: deduplicated, checked, at most N', () => {
    assert.deepEqual([...K.parseNumbers('+14155550123\n+1 415 555 0123, +14155550124', '', 5).numbers], ['+14155550123', '+14155550124']);
    assert.match(K.parseNumbers('+14155550123\nnope', '', 5).problem, /not a phone number/);
    assert.match(K.parseNumbers('+14155550121,+14155550122,+14155550123', '', 2).problem, /Up to 2/);
  });
  test('mask keeps a number recognizable without writing it out', () => {
    assert.equal(K.mask('+14155550123'), '+141•••123');
  });
});

describe('errors in plain words', () => {
  const { K } = sheetGas();
  const err = (code, extra = {}) => Object.assign(new Error('SMSTunnel: words from the server'), { name: 'SmsTunnelError', code, ...extra });
  test('each code gets its explanation and its kind', () => {
    assert.match(K.explainError(err('UNAUTHORIZED')), /did not accept the key/);
    assert.match(K.explainError(err('NO_API_KEY')), /Set up/);
    assert.match(K.explainError(err('PERMISSION_REQUIRED', { permission: 'sms:send' })), /\(sms:send\)/);
    assert.match(K.explainError(err('RATE_LIMITED', { retryAfter: 20 })), /wait 20 s/);
    assert.match(K.explainError(err('NETWORK_ERROR')), /could not be reached/);
    assert.match(K.explainError(err('NOT_FOUND')), /still linked under Phones/);
    assert.equal(K.explainError(err('BAD_REQUEST')), 'words from the server');
    assert.equal(K.problemKind(err('BAD_REQUEST')), 'row');
    assert.equal(K.problemKind(err('INVALID_NUMBER')), 'row');
    assert.equal(K.problemKind(err('SERVER_ERROR', { retryable: true })), 'transient');
    assert.equal(K.problemKind(err('UNAUTHORIZED')), 'account');
    assert.equal(K.problemKind(err('NOT_FOUND')), 'account');
  });
  test('sendOne answers instead of throwing for SMSTunnel errors, and rethrows bugs', () => {
    const { gas, K: kit } = sheetGas(() => ({ status: 401, body: { message: 'Invalid or expired API key', statusCode: 401 } }));
    gas.useKey(KEY);
    const out = kit.sendOne('+14155550123', 'Hi', {});
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'account');
    assert.match(out.explain, /did not accept the key/);
    // A failing fetch is a network error (that's how UrlFetchApp reports one)...
    const { gas: g2, K: k2 } = sheetGas(() => {
      throw new TypeError('socket hang up');
    });
    g2.useKey(KEY);
    assert.equal(k2.sendOne('+14155550123', 'Hi', {}).kind, 'transient');
    // ...but a bug anywhere else is not swallowed.
    g2.context.PropertiesService.getUserProperties = () => {
      throw new TypeError('a bug');
    };
    assert.throws(() => k2.sendOne('+14155550123', 'Hi', {}), /a bug/);
  });
});

describe('one setup per spreadsheet', () => {
  test('the latest setup sends; an older one sees "other" and its trigger removes itself', () => {
    const { gas, K, app } = sheetGas();
    assert.equal(K.setupState(), 'none');
    K.saveSettings({ enabled: true });
    K.claimSetup();
    assert.equal(K.setupState(), 'mine');
    // The owner's trigger.
    const alice = gas.context.ScriptApp.newTrigger('smstunnelOnEdit').forSpreadsheet(gas.spreadsheet).onEdit().create();
    // Bob, another editor, sees the owner's setup, then sets the texts up too.
    gas.as('bob');
    assert.equal(K.setupState(), 'other');
    K.saveSettings({ enabled: true });
    K.claimSetup();
    assert.equal(K.setupState(), 'mine');
    gas.as('owner');
    assert.equal(K.setupState(), 'other');
    assert.equal(K.beginRun({ triggerUid: alice.getUniqueId() }, app), null);
    assert.equal(gas.triggers.filter((t) => t.user === 'owner').length, 0, "the old setup's trigger removed itself");
    assert.match(gas.logs.map((l) => l.text).join('\n'), /removes itself/);
    gas.as('bob');
    assert.equal(K.beginRun({ triggerUid: 'whatever' }, app).enabled, true);
  });

  test('turning off removes the triggers and keeps the key', () => {
    const { gas, K, app } = sheetGas();
    gas.useKey(KEY);
    K.saveSettings({ enabled: true });
    K.claimSetup();
    gas.context.ScriptApp.newTrigger('smstunnelOnEdit').forSpreadsheet(gas.spreadsheet).onEdit().create();
    K.turnOff(app);
    assert.equal(gas.triggers.length, 0);
    assert.equal(K.setupState(), 'none');
    assert.equal(K.loadSettings().enabled, false);
    assert.equal(gas.userProps.getProperty('SMSTUNNEL_API_KEY'), KEY);
  });

  test('a run that cannot get the lock says busy and sends nothing', () => {
    const { gas, K } = sheetGas();
    gas.locks.blocked = true;
    assert.equal(K.withLock(() => 'ran').busy, true);
    gas.locks.blocked = false;
    assert.equal(K.withLock(() => 'ran'), 'ran');
  });
});

describe('never twice', () => {
  test('a form response id is remembered (as a short hash), and the list stays under the 9 kB property limit', () => {
    const gas = createGas({ project: 'forms-text-me', http: fakeApi(), form: { title: 'F', items: [] } });
    const K = gas.global('SmsTunnelKit');
    assert.equal(K.seenBefore('2_ABaOnudAbc'), false);
    assert.equal(K.seenBefore('2_ABaOnudAbc'), true);
    for (let i = 0; i < 450; i++) K.seenBefore('response-' + i);
    const stored = gas.userProps.getProperty('SMSTUNNEL_SEEN');
    assert.ok(stored.length < 9 * 1024);
    assert.equal(stored.includes('2_ABaOnud'), false, 'only hashes are kept');
    assert.equal(K.seenBefore('response-449'), true);
  });

  test('the sent store keeps ids in a hidden sheet and forgets events long past', () => {
    const { gas, K } = sheetGas();
    const store = K.sentStore();
    assert.equal(store.has('me|e1|2026-11-02T08:00:00.000Z|+14155550123'), false);
    store.add('me|e1|2026-11-02T08:00:00.000Z|+14155550123', new Date('2026-11-02T08:00:00Z'));
    store.add('me|e2|2026-10-01T08:00:00.000Z|+14155550123', new Date('2026-10-01T08:00:00Z'));
    const sheet = gas.spreadsheet.getSheetByName('SMSTunnel sent');
    assert.equal(sheet.isSheetHidden(), true);
    assert.equal(K.sentStore().has('me|e1|2026-11-02T08:00:00.000Z|+14155550123'), true);
    assert.equal(K.pruneSent(new Date('2026-10-20T00:00:00Z')), 1);
    assert.equal(K.sentStore().has('me|e2|2026-10-01T08:00:00.000Z|+14155550123'), false);
    assert.equal(K.sentStore().has('me|e1|2026-11-02T08:00:00.000Z|+14155550123'), true);
  });

  test('the log sheet keeps the last 2000 lines, as text', () => {
    const { gas, K, app } = sheetGas();
    for (let i = 0; i < 2005; i++) K.log(app, { where: 'Row ' + i, to: '+14155550123', result: 'Sent', details: '=1+1' });
    const log = gas.spreadsheet.getSheetByName('SMSTunnel log');
    assert.equal(log.getLastRow(), 2001);
    const first = log.getRange(2, 1, 1, 6).getDisplayValues()[0];
    assert.equal(first[2], 'Row 5');
    assert.equal(first[3], '+14155550123');
    assert.equal(first[5], '=1+1');
    assert.equal(log.formulas.length, 0);
  });
});

describe('menu helpers', () => {
  test('Send a test text asks for your number and sends one text', () => {
    const api = fakeApi();
    const { gas } = sheetGas(api);
    gas.useKey(KEY);
    gas.ui.promptAnswers.push({ button: 'OK', text: '+1 415 555 0123' });
    gas.run('smstunnelSendTestText');
    assert.equal(api.sent.length, 1);
    assert.equal(api.sent[0].to, '+14155550123');
    assert.match(api.sent[0].message, /SMSTunnel test from "Orders 2026": it works/);
    assert.match(gas.ui.alerts.at(-1).title, /Test text sent/);
  });

  test('Send a test text without a key or with a bad number sends nothing', () => {
    const api = fakeApi();
    const { gas } = sheetGas(api);
    gas.run('smstunnelSendTestText');
    assert.match(gas.ui.alerts.at(-1).title, /Set up first/);
    gas.useKey(KEY);
    gas.ui.promptAnswers.push({ button: 'OK', text: '0722 123 456' });
    gas.run('smstunnelSendTestText');
    assert.match(gas.ui.alerts.at(-1).text, /no country code/);
    gas.ui.promptAnswers.push({ button: 'CANCEL', text: '+14155550123' });
    gas.run('smstunnelSendTestText');
    assert.equal(api.sent.length, 0);
  });

  test('Help escapes what it shows', () => {
    const { gas, K } = sheetGas();
    K.saveSettings({ enabled: true, statusColumn: '<img src=x onerror=alert(1)>', statusValue: 'Shipped' });
    gas.run('smstunnelHelp');
    const html = gas.ui.dialogs.at(-1).html;
    assert.equal(html.includes('<img src=x'), false);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /not affiliated with, endorsed by, or sponsored by Google/);
  });
});
