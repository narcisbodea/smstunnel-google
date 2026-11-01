import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi, zoned } from '../harness/gas.mjs';

const KEY = 'sk_live_reminders-test-01';
const TZ = 'Europe/Bucharest';
const at = (y, m, d, h = 0, min = 0) => zoned(y, m, d, h, min, 0, TZ);
const NOW = at(2026, 11, 2, 10, 0); // Monday 2 Nov 2026, 10:00 in Bucharest
const HEADERS = ['Name', 'Phone', 'Date', 'Time'];

function setup({ http = fakeApi(), input = {}, sheetRows } = {}) {
  const gas = createGas({ project: 'sheets-reminders', http, spreadsheet: { name: 'Clinic', timeZone: TZ, sheets: [{ name: 'Appointments', rows: sheetRows }] } });
  const sheet = gas.spreadsheet.getSheetByName('Appointments');
  const result = gas.run('smstunnelSaveSetup', {
    apiKey: KEY,
    sheetId: String(sheet.getSheetId()),
    phoneColumn: 'Phone',
    dateColumn: 'Date',
    timeColumn: 'Time',
    message: 'Hi {Name}, see you on {Date} at {Time}.',
    hoursBefore: 24,
    frequency: 'hourly',
    dailyHour: 9,
    quietFrom: 8,
    quietTo: 21,
    countryCode: '+40',
    cap: 25,
    deviceId: '',
    ...input,
  });
  const settings = () => JSON.parse(gas.userProps.getProperty('SMSTUNNEL_SETTINGS'));
  const run = (now = NOW, opts = {}) => gas.run('smstunnelRunReminders_', settings(), now, opts);
  return { gas, sheet, result, api: http, run, settings };
}

// Sheets keeps a time-only cell as a date on 30 Dec 1899.
const time = (h, m) => ({ v: zoned(1899, 12, 30, h, m, 0, TZ), d: `${h}:${String(m).padStart(2, '0')}` });
const date = (y, m, d) => ({ v: at(y, m, d), d: `${m}/${d}/${y}` });
const sentCell = (sheet, row) => sheet.getRange(row, 5).getValue();

describe('Set up', () => {
  test('adds "Reminder sent" and an hourly trigger; daily runs at the chosen hour in the sheet\'s time zone', () => {
    const { gas, sheet, result } = setup({ sheetRows: [HEADERS] });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(sheet.getRange(1, 5).getValue(), 'Reminder sent');
    assert.deepEqual(gas.triggers.map((t) => [t.handler, t.everyHours]), [['smstunnelSendReminders', 1]]);
    const daily = setup({ sheetRows: [HEADERS], input: { frequency: 'daily', dailyHour: 9 } });
    assert.deepEqual(daily.gas.triggers.map((t) => [t.everyDays, t.atHour, t.inTimezone]), [[1, 9, TZ]]);
  });

  test('a daily check outside the allowed hours, a reversed quiet window and unknown columns are refused', () => {
    const { result } = setup({ sheetRows: [HEADERS], input: { frequency: 'daily', dailyHour: 22, message: '{Nope}', timeColumn: 'Phone' } });
    assert.match(result.errors.dailyHour, /between 8:00 and 21:00/);
    assert.match(result.errors.message, /\{Nope\}/);
    assert.match(result.errors.timeColumn, /different column/);
    const reversed = setup({ sheetRows: [HEADERS], input: { quietFrom: 21, quietTo: 8 } });
    assert.match(reversed.result.errors.quietFrom, /before the second/);
  });
});

describe('the reminder run', () => {
  const sheetRows = [
    HEADERS,
    ['Ana', '+40722000001', date(2026, 11, 2), time(14, 30)], // in 4.5 h → due
    ['Bo', '0722 000 002', date(2026, 11, 3), time(9, 0)], // in 23 h → due
    ['Cy', '+40722000003', date(2026, 11, 3), time(11, 0)], // in 25 h → not yet
    ['Di', '+40722000004', date(2026, 11, 2), time(9, 0)], // an hour ago → never
    ['Ed', '', date(2026, 11, 2), time(15, 0)], // no number → skipped, marked
    ['Fi', '+40722000006', '', ''], // no date → ignored
    ['Gu', '+40722000007', '2026-11-02 18:15', ''], // a date written as text → due
    ['Ho', '+40722000008', 'next Tuesday', ''], // can't be read
    ['Io', '+40722000009', date(2026, 11, 2), '2:45 PM'], // time written as text → due
  ];

  test('texts the rows due within the hours chosen, soonest first, once', () => {
    const { sheet, run, api, gas } = setup({ sheetRows });
    const outcome = run();
    assert.equal(outcome.sent, 4);
    assert.equal(outcome.notSent, 1);
    assert.deepEqual(api.sent.map((s) => s.to), ['+40722000001', '+40722000009', '+40722000007', '+40722000002']);
    assert.equal(api.sent[0].message, 'Hi Ana, see you on 11/2/2026 at 14:30.');
    assert.deepEqual([...outcome.unreadable], [9]);
    assert.match(sentCell(sheet, 6), /^Not sent: There is no phone number/);
    assert.equal(sentCell(sheet, 4), '');
    assert.equal(sentCell(sheet, 5), '');
    assert.match(sheet.getRange(2, 5).getNote(), /Reminder sent to \+40722000001\nMessage id: msg0001/);
    assert.equal(gas.sleeps.length, 3);
    const again = run(at(2026, 11, 2, 10, 30));
    assert.equal(again.sent, 0, 'never twice');
    assert.equal(api.sent.length, 4);
    const later = run(at(2026, 11, 2, 11, 30));
    assert.equal(later.sent, 1, 'Cy comes into the window');
    assert.equal(api.sent.at(-1).to, '+40722000003');
  });

  test('nothing goes out outside the allowed hours', () => {
    const { run, api } = setup({ sheetRows });
    const outcome = run(at(2026, 11, 2, 22, 30));
    assert.equal(outcome.quiet, true);
    assert.equal(api.sent.length, 0);
    const morning = run(at(2026, 11, 3, 8, 5));
    assert.equal(morning.sent, 2, 'Bo (09:00) and Cy (11:00) the next morning');
  });

  test('at most cap reminders per run; the rest go on the next run', () => {
    const many = [HEADERS];
    for (let i = 0; i < 30; i++) many.push(['P' + i, '+4072210' + String(1000 + i), date(2026, 11, 2), time(12 + Math.floor(i / 10), i % 10)]);
    const { run, api, gas } = setup({ sheetRows: many, input: { cap: 25 } });
    const first = run();
    assert.equal(first.sent, 25);
    assert.equal(first.waiting, 5);
    assert.match(gas.spreadsheet.getSheetByName('SMSTunnel log').table().at(-1).join('|'), /5 more reminders wait/);
    const second = run(at(2026, 11, 2, 11, 0));
    assert.equal(second.sent, 5);
    assert.equal(new Set(api.sent.map((s) => s.to)).size, 30);
    assert.deepEqual(api.sent.slice(0, 3).map((s) => s.to), ['+40722101000', '+40722101001', '+40722101002']);
  });

  test('a server error stops the run and leaves the rest waiting', () => {
    const api = fakeApi({ failWith: (request) => (request.url.endsWith('/sms/send') && JSON.parse(request.payload).to.endsWith('09') ? { status: 500, body: { message: 'boom', statusCode: 500 } } : null) });
    const { run, sheet } = setup({ http: api, sheetRows });
    const outcome = run();
    assert.match(outcome.stopped, /could not be reached/);
    assert.equal(outcome.sent, 1);
    assert.equal(sentCell(sheet, 10), '');
    assert.equal(sentCell(sheet, 8), '', 'rows after the stop wait');
  });

  test('the time trigger runs it, and a dead key makes the run fail', () => {
    let refuse = false;
    const api = fakeApi({ failWith: (request) => (refuse && request.url.endsWith('/sms/send') ? { status: 401, body: { message: 'Invalid or expired API key', statusCode: 401 } } : null) });
    const { gas } = setup({ http: api, sheetRows: [HEADERS, ['Ana', '+40722000001', { v: new Date(Date.now() + 2 * 3600000), d: 'soon' }, '']] });
    const settings = JSON.parse(gas.userProps.getProperty('SMSTUNNEL_SETTINGS'));
    settings.quietFrom = 0;
    settings.quietTo = 24;
    gas.userProps.setProperty('SMSTUNNEL_SETTINGS', JSON.stringify(settings));
    refuse = true;
    assert.throws(() => gas.run('smstunnelSendReminders', { triggerUid: gas.triggers[0].id }), /did not accept the key/);
    refuse = false;
    gas.run('smstunnelSendReminders', { triggerUid: gas.triggers[0].id });
    assert.equal(api.sent.length, 1);
  });

  test('Preview lists what would go out and sends nothing', () => {
    const { gas, api } = setup({ sheetRows });
    gas.run('smstunnelPreview');
    assert.equal(api.sent.length, 0);
    const html = gas.ui.dialogs.at(-1).html;
    assert.match(html, /Nothing is sent from this window/);
    assert.match(html, /Row 6/);
    assert.match(html, /can.t read/);
  });

  test('Send due reminders now asks before sending outside the allowed hours', () => {
    const { gas, api } = setup({ sheetRows: [HEADERS, ['Ana', '+40722000001', { v: new Date(Date.now() + 3600000), d: 'soon' }, '']] });
    const settings = JSON.parse(gas.userProps.getProperty('SMSTUNNEL_SETTINGS'));
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    settings.quietFrom = hour >= 23 ? 0 : hour + 1;
    settings.quietTo = hour >= 23 ? 1 : 24;
    if (hour === 0) settings.quietFrom = 1;
    gas.userProps.setProperty('SMSTUNNEL_SETTINGS', JSON.stringify(settings));
    gas.ui.answers.push('NO');
    gas.run('smstunnelSendDueNow');
    assert.match(gas.ui.alerts.at(-1).title, /Outside your hours/);
    assert.equal(api.sent.length, 0);
    gas.run('smstunnelSendDueNow');
    assert.equal(api.sent.length, 1);
  });

  test('a typed time and a date with its own time', () => {
    const { run, api } = setup({
      sheetRows: [HEADERS, ['Ana', '+40722000001', { v: at(2026, 11, 2, 16, 20), d: '11/2/2026 16:20' }, ''], ['Bo', '+40722000002', date(2026, 11, 2), '9am']],
      input: { message: '{Name} {Date}' },
    });
    run();
    assert.deepEqual(api.sent.map((s) => s.to), ['+40722000001']);
  });
});

describe('typed times', () => {
  const { gas } = setup({ sheetRows: [HEADERS] });
  for (const [text, out] of [['14:30', '14:30'], ['9:05', '09:05'], ['2:30 PM', '14:30'], ['12 am', '00:00'], ['12:15 p.m.', '12:15'], ['9am', '09:00'], ['14h30', '14:30'], ['9', ''], ['25:00', ''], ['13 pm', ''], ['noon', '']]) {
    test(`"${text}" → "${out}"`, () => assert.equal(gas.run('smstunnelTimeText_', text), out));
  }
});
