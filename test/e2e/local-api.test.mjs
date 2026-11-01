/**
 * End to end: the shipped Apps Script code (through the UrlFetchApp shim, backed by a real synchronous fetch)
 * sends through a LOCAL SMSTunnel API, and each text is then looked up, read-only, in its MongoDB `messages`.
 *
 *   SMSTUNNEL_TEST_KEY_FILE  JSON with serverUrl (must be local), apiKey, deviceId
 *   SMSTUNNEL_TEST_MONGO     mongodb://127.0.0.1:27018/smstunnel_app_dev by default
 *   SMSTUNNEL_SERVER_SRC     where the server's node_modules (for the mongodb driver) are
 *
 * It never talks to https://smstunnel.io. It skips when the key file or the local API is missing.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGas } from '../harness/gas.mjs';

const KEY_FILE =
  process.env.SMSTUNNEL_TEST_KEY_FILE ||
  'C:/Users/narci/AppData/Local/Temp/claude/D--ANDROID/cdaad977-8aae-4372-bca7-304ef9cf5e37/scratchpad/integrari/local-test-key.json';
const MONGO_URL = process.env.SMSTUNNEL_TEST_MONGO || 'mongodb://127.0.0.1:27018/smstunnel_app_dev';
const SERVER = process.env.SMSTUNNEL_SERVER_SRC || 'D:/ANDROID/SMSserver';
const RUN = 'gas-e2e-' + Date.now().toString(36);

let cfg = null;
let mongo = null;
let db = null;
let skip = false;
const opened = [];

before(async () => {
  if (!existsSync(KEY_FILE)) {
    skip = 'no test key file at ' + KEY_FILE;
    return;
  }
  cfg = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(cfg.serverUrl)) throw new Error('These tests only talk to a local SMSTunnel, not ' + cfg.serverUrl);
  try {
    const res = await fetch(cfg.serverUrl + '/api/v1/devices', { headers: { 'X-API-Key': cfg.apiKey } });
    if (!res.ok) skip = 'the local API answered ' + res.status;
  } catch (err) {
    skip = 'the local API is not reachable at ' + cfg.serverUrl;
  }
  if (skip) return;
  const { MongoClient } = createRequire(join(SERVER, 'package.json'))('mongodb');
  mongo = new MongoClient(MONGO_URL);
  await mongo.connect();
  db = mongo.db();
});

after(async () => {
  for (const gas of opened) await gas.close();
  if (mongo) await mongo.close();
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gasFor(project, extra = {}) {
  const gas = createGas({ project, http: 'local', ...extra });
  gas.userProps.setProperty('SMSTUNNEL_SERVER_URL', cfg.serverUrl);
  opened.push(gas);
  return gas;
}

/** The text in `messages` (read-only), once the simulated phone has marked it sent. */
async function stored(text, { status = 'sent', timeoutMs = 20000 } = {}) {
  const until = Date.now() + timeoutMs;
  let doc = null;
  while (Date.now() < until) {
    doc = await db.collection('messages').findOne({ message: text });
    if (doc && (!status || doc.status === status)) return doc;
    await wait(400);
  }
  return doc;
}

/**
 * Runs fn; when the shared local API says "too many" (other agents use it too), waits and runs it again. Every
 * template keeps a row or event pending when it is refused this way, so running it again is safe.
 */
async function politely(fn, isLimited) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let out;
    let error = null;
    try {
      out = fn();
    } catch (err) {
      error = err;
    }
    const limited = error ? error.code === 'RATE_LIMITED' : isLimited ? isLimited(out) : false;
    if (!limited) {
      if (error) throw error;
      return out;
    }
    await wait(((error && error.retryAfter) || 30) * 1000 + 1000);
  }
  throw new Error('the local API kept answering 429');
}

describe('the library against the local API', () => {
  test('getPhones lists the test phone', (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('library');
    gas.useKey(cfg.apiKey);
    const phones = gas.global('SmsTunnel').getPhones();
    const phone = phones.find((p) => p.id === cfg.deviceId);
    assert.ok(phone, 'the test phone is listed');
    assert.equal(phone.isOnline, true);
  });

  test('sendSms: the text is stored for +14155550141 and the phone sends it; getStatus follows it', async (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('library');
    gas.useKey(cfg.apiKey);
    const S = gas.global('SmsTunnel');
    const text = RUN + ' library: your order has shipped';
    const result = await politely(() => S.sendSms('+14155550141', text));
    assert.match(result.messageId, /^[0-9a-f]{24}$/);
    const doc = await stored(text);
    assert.ok(doc, 'stored in messages');
    assert.equal(doc.phoneNumber, '+14155550141');
    assert.equal(doc.status, 'sent');
    assert.equal(String(doc._id), result.messageId);
    const status = S.getStatus(result.messageId);
    assert.equal(status.status, 'sent');
    assert.equal(status.phoneNumber, '+14155550141');
  });

  test('a local number with defaultCountryCode, through a chosen phone', async (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('library');
    gas.useKey(cfg.apiKey);
    const text = RUN + ' library: local number';
    await politely(() => gas.global('SmsTunnel').sendSms('(415) 555-0142', text, { defaultCountryCode: '1', deviceId: cfg.deviceId }));
    const doc = await stored(text);
    assert.equal(doc.phoneNumber, '+14155550142');
    assert.equal(String(doc.deviceId), cfg.deviceId);
  });

  test('sendCode goes through /send-2fa; a text without a code never leaves the script', async (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('library');
    gas.useKey(cfg.apiKey);
    const S = gas.global('SmsTunnel');
    const text = RUN + ' your sign-in code is 482913';
    await politely(() => S.sendCode('+14155550143', text));
    const doc = await stored(text);
    assert.equal(doc.phoneNumber, '+14155550143');
    const before = gas.requests.length;
    assert.throws(() => S.sendCode('+14155550143', RUN + ' code A1B2C3'), (err) => err.code === 'NO_CODE');
    assert.equal(gas.requests.length, before);
  });

  test('a wrong key is UNAUTHORIZED, an unknown message NOT_FOUND, and nothing is stored', async (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('library');
    gas.useKey('sk_live_this-key-does-not-exist');
    const S = gas.global('SmsTunnel');
    const text = RUN + ' wrong key';
    assert.throws(() => S.sendSms('+14155550144', text), (err) => err.code === 'UNAUTHORIZED' && err.status === 401 && err.retryable === false);
    assert.equal(await stored(text, { status: null, timeoutMs: 600 }), null);
    gas.useKey(cfg.apiKey);
    assert.throws(() => S.getStatus('000000000000000000000000'), (err) => err.code === 'NOT_FOUND' && err.status === 404);
  });
});

describe('the templates against the local API', () => {
  test('Google Forms: your text and the confirmation', async (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('forms-text-me', {
      form: { title: 'E2E booking', items: [{ id: 1, title: 'Name' }, { id: 2, title: 'Phone' }] },
    });
    const saved = gas.run('smstunnelSaveSetup', {
      apiKey: cfg.apiKey,
      ownerNumbers: '+14155550151',
      ownerMessage: RUN + ' forms: {Name} booked',
      confirm: true,
      phoneQuestionId: '2',
      confirmMessage: RUN + ' forms: thanks {Name}',
      countryCode: '+1',
    });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
    const trigger = gas.triggers[0];
    await politely(
      () => gas.run('smstunnelOnFormSubmit', { response: gas.form.response({ answers: { Name: 'Ana', Phone: '415 555 0152' } }), source: gas.form, triggerUid: trigger.id }),
      () => JSON.parse(gas.userProps.getProperty('SMSTUNNEL_RECENT') || '[]').some((r) => /Too many/.test(r.details || ''))
    );
    const mine = await stored(RUN + ' forms: Ana booked');
    const confirmation = await stored(RUN + ' forms: thanks Ana');
    assert.equal(mine.phoneNumber, '+14155550151');
    assert.equal(confirmation.phoneNumber, '+14155550152');
    assert.equal(gas.everything().includes(cfg.apiKey), false);
  });

  test('Google Sheets status texts: the row is texted and marked', async (t) => {
    if (skip) return t.skip(skip);
    const gas = gasFor('sheets-status-texts', {
      spreadsheet: { name: 'E2E orders', sheets: [{ name: 'Orders', rows: [['Name', 'Order', 'Phone', 'Status'], ['Bo', 'E-1', '+14155550161', 'Packing']] }] },
    });
    const sheet = gas.spreadsheet.getSheetByName('Orders');
    const saved = gas.run('smstunnelSaveSetup', {
      apiKey: cfg.apiKey, sheetId: String(sheet.getSheetId()), statusColumn: 'Status', statusValue: 'Shipped', phoneColumn: 'Phone',
      message: RUN + ' status: Hi {Name}, order {Order} has shipped', countryCode: '', cap: 20,
    });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
    sheet.getRange(2, 4).setValue('Shipped');
    await politely(
      () => gas.run('smstunnelOnEdit', { range: sheet.getRange(2, 4), source: gas.spreadsheet, triggerUid: gas.triggers[0].id }),
      () => sheet.getRange(2, 5).getValue() === ''
    );
    const doc = await stored(RUN + ' status: Hi Bo, order E-1 has shipped');
    assert.equal(doc.phoneNumber, '+14155550161');
    assert.equal(Object.prototype.toString.call(sheet.getRange(2, 5).getValue()), '[object Date]');
    assert.match(sheet.getRange(2, 5).getNote(), new RegExp('Message id: ' + String(doc._id)));
    assert.equal(gas.everything().includes(cfg.apiKey), false);
  });

  test('Google Sheets appointment reminders: the two due rows, once', async (t) => {
    if (skip) return t.skip(skip);
    const now = Date.now();
    const gas = gasFor('sheets-reminders', {
      spreadsheet: {
        name: 'E2E clinic',
        sheets: [{ name: 'Appointments', rows: [
          ['Name', 'Phone', 'When'],
          ['Cy', '+14155550171', new Date(now + 2 * 3600000)],
          ['Di', '+14155550172', new Date(now + 5 * 3600000)],
          ['Ed', '+14155550173', new Date(now + 40 * 3600000)],
        ] }],
      },
    });
    const sheet = gas.spreadsheet.getSheetByName('Appointments');
    const saved = gas.run('smstunnelSaveSetup', {
      apiKey: cfg.apiKey, sheetId: String(sheet.getSheetId()), phoneColumn: 'Phone', dateColumn: 'When', timeColumn: '',
      message: RUN + ' reminder for {Name}', hoursBefore: 24, frequency: 'hourly', quietFrom: 0, quietTo: 24, countryCode: '', cap: 25,
    });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
    await politely(
      () => gas.run('smstunnelSendReminders', { triggerUid: gas.triggers[0].id }),
      () => sheet.getRange(2, 4).getValue() === '' || sheet.getRange(3, 4).getValue() === ''
    );
    assert.equal((await stored(RUN + ' reminder for Cy')).phoneNumber, '+14155550171');
    assert.equal((await stored(RUN + ' reminder for Di')).phoneNumber, '+14155550172');
    assert.equal(sheet.getRange(4, 4).getValue(), '', 'Ed is 40 hours away');
    const before = gas.requests.filter((r) => r.url.endsWith('/sms/send')).length;
    gas.run('smstunnelSendReminders', { triggerUid: gas.triggers[0].id });
    assert.equal(gas.requests.filter((r) => r.url.endsWith('/sms/send')).length, before, 'never twice');
    assert.equal(await db.collection('messages').countDocuments({ message: RUN + ' reminder for Cy' }), 1);
  });

  test('Google Calendar: "remind me" and a reminder to the person in the event', async (t) => {
    if (skip) return t.skip(skip);
    const now = Date.now();
    const gas = gasFor('calendar-reminders', {
      calendars: [
        { id: 'me@example.com', name: 'Me', primary: true, events: [{ id: 'e2e-dentist', title: RUN + ' Dentist', start: new Date(now + 10 * 60000) }] },
        { id: 'work@example.com', name: 'Appointments', events: [{ id: 'e2e-client', title: 'Haircut', start: new Date(now + 3 * 3600000), description: 'SMS: +1 415 555 0182' }] },
      ],
      spreadsheet: { name: 'E2E calendar', sheets: [{ name: 'Start here' }] },
    });
    const saved = gas.run('smstunnelSaveSetup', {
      apiKey: cfg.apiKey, ownerNumbers: '+14155550181', countryCode: '+1', dateStyle: 'iso', cap: 25,
      me: { on: true, calendars: ['me@example.com'], lead: 15, message: 'Reminder: {Title}' },
      agenda: { on: false, hour: 7, minute: 0 },
      clients: { on: true, calendars: ['work@example.com'], hours: 24, labels: 'SMS', fromDescription: true, fromGuests: false, quietFrom: 0, quietTo: 24, message: RUN + ' appointment: {Title}' },
    });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
    assert.equal(gas.triggers[0].everyMinutes, 5);
    await politely(
      () => gas.run('smstunnelCheckCalendar', { triggerUid: gas.triggers[0].id }),
      () => /Too many/.test(gas.spreadsheet.getSheetByName('SMSTunnel log').table().map((row) => row.join('|')).join('\n'))
    );
    assert.equal((await stored('Reminder: ' + RUN + ' Dentist')).phoneNumber, '+14155550181');
    assert.equal((await stored(RUN + ' appointment: Haircut')).phoneNumber, '+14155550182');
    const sends = gas.requests.filter((r) => r.url.endsWith('/sms/send')).length;
    gas.run('smstunnelCheckCalendar', { triggerUid: gas.triggers[0].id });
    assert.equal(gas.requests.filter((r) => r.url.endsWith('/sms/send')).length, sends, 'never twice');
    assert.equal(gas.everything().includes(cfg.apiKey), false);
  });
});
