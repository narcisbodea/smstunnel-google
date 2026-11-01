import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi } from '../harness/gas.mjs';

const KEY = 'sk_live_status-test-key-1';
const HEADERS = ['Name', 'Order', 'Phone', 'Status'];

function rows(extra = []) {
  return [
    HEADERS,
    ['Ana', 'A-100', '+14155550101', 'Packing'],
    ['Bo', 'A-101', { v: 14155550102, d: '14155550102' }, 'Shipped'],
    ['Cy', 'A-102', '0722 123 456', 'Packing'],
    ['Di', 'A-103', 'no phone', 'Packing'],
    ...extra,
  ];
}

function setup({ http = fakeApi(), input = {}, sheetRows = rows() } = {}) {
  const gas = createGas({ project: 'sheets-status-texts', http, spreadsheet: { name: 'Orders', timeZone: 'America/New_York', sheets: [{ name: 'Orders', rows: sheetRows }, { name: 'Notes', rows: [['x']] }] } });
  const sheet = gas.spreadsheet.getSheetByName('Orders');
  const result = gas.run('smstunnelSaveSetup', {
    apiKey: KEY,
    sheetId: String(sheet.getSheetId()),
    statusColumn: 'Status',
    statusValue: 'Shipped',
    phoneColumn: 'Phone',
    message: 'Hi {Name}, order {Order} has {status}.',
    countryCode: '+40',
    deviceId: '',
    sweep: false,
    cap: 20,
    ...input,
  });
  return { gas, sheet, result, api: http };
}

/** Sets a cell the way a person does and runs the edit trigger. */
function edit(gas, sheet, row, column, value, numRows = 1) {
  for (let r = 0; r < numRows; r++) sheet.getRange(row + r, column).setValue(value);
  const trigger = gas.triggers.find((t) => t.handler === 'smstunnelOnEdit' && t.user === gas.user);
  return gas.run('smstunnelOnEdit', { range: sheet.getRange(row, column, numRows, 1), source: gas.spreadsheet, triggerUid: trigger ? trigger.id : 'none' });
}

const texted = (sheet, row) => sheet.getRange(row, 5).getValue();

describe('Set up', () => {
  test('adds "Texted at", marks the rows that already have the value, and makes the edit trigger', () => {
    const { gas, sheet, result } = setup();
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.match(result.message, /1 row was already "Shipped"/);
    assert.equal(sheet.getRange(1, 5).getValue(), 'Texted at');
    assert.match(texted(sheet, 3), /^Skipped: already Shipped before SMSTunnel was set up/);
    assert.equal(texted(sheet, 2), '');
    assert.deepEqual(gas.triggers.map((t) => [t.handler, t.event]), [['smstunnelOnEdit', 'ON_EDIT']]);
    assert.ok(gas.spreadsheet.getSheetByName('SMSTunnel log'));
    assert.equal(gas.userProps.getProperty('SMSTUNNEL_API_KEY'), KEY);
  });

  test('the 15-minute check is a second trigger, only when chosen', () => {
    const { gas } = setup({ input: { sweep: true } });
    assert.deepEqual(gas.triggers.map((t) => [t.handler, t.everyMinutes]).sort(), [['smstunnelCheckWaitingRows', 15], ['smstunnelOnEdit', undefined]].sort());
  });

  test('checks the columns, the value, the text and the limit', () => {
    const { result } = setup({ input: { statusColumn: 'Nope', phoneColumn: 'Nope', statusValue: '', message: 'Hi {Nmae}', cap: 500, countryCode: 'x' } });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors).sort(), ['cap', 'countryCode', 'message', 'phoneColumn', 'statusColumn', 'statusValue']);
    assert.match(result.errors.message, /\{Nmae\}/);
    const same = setup({ input: { phoneColumn: 'Status' } });
    assert.match(same.result.errors.phoneColumn, /different column/);
  });

  test('the dialog data lists the sheets with their columns and a sample row', () => {
    const { gas } = setup();
    const data = gas.run('smstunnelGetSetupData');
    const orders = data.sheets.find((s) => s.name === 'Orders');
    assert.deepEqual(orders.headers, [...HEADERS, 'Texted at']);
    assert.deepEqual(orders.sample.slice(0, 2), ['Ana', 'A-100']);
    assert.equal(data.sheets.some((s) => s.name === 'SMSTunnel log'), false);
    assert.equal(data.on, true);
    assert.equal(data.configured, true);
  });
});

describe('when the status changes', () => {
  test('texts the number in the row with the row filled in, once', () => {
    const { gas, sheet, api } = setup();
    edit(gas, sheet, 2, 4, 'Shipped');
    assert.equal(api.sent.length, 1);
    assert.deepEqual([api.sent[0].to, api.sent[0].message], ['+14155550101', 'Hi Ana, order A-100 has Shipped.']);
    assert.equal(Object.prototype.toString.call(texted(sheet, 2)), '[object Date]');
    assert.match(sheet.getRange(2, 5).getNote(), /Texted \+14155550101\nMessage id: msg0001/);
    edit(gas, sheet, 2, 4, 'Packing');
    edit(gas, sheet, 2, 4, 'shipped ');
    assert.equal(api.sent.length, 1, 'never twice');
    const log = gas.spreadsheet.getSheetByName('SMSTunnel log').table();
    assert.deepEqual(log[1].slice(1, 5), ['Status texts', 'Row 2', '+14155550101', 'Sent']);
  });

  test('a local number gets the country code; edits elsewhere, other values and other sheets do nothing', () => {
    const { gas, sheet, api } = setup();
    edit(gas, sheet, 4, 4, 'Ready');
    edit(gas, sheet, 4, 1, 'Shipped');
    const notes = gas.spreadsheet.getSheetByName('Notes');
    notes.getRange(1, 1).setValue('Shipped');
    gas.run('smstunnelOnEdit', { range: notes.getRange(1, 1), source: gas.spreadsheet, triggerUid: gas.triggers[0].id });
    assert.equal(api.sent.length, 0);
    edit(gas, sheet, 4, 4, 'Shipped');
    assert.equal(api.sent[0].to, '+40722123456');
  });

  test('a row without a valid number is marked "Not sent" with the reason, and logged', () => {
    const { gas, sheet, api } = setup();
    edit(gas, sheet, 5, 4, 'Shipped');
    assert.equal(api.sent.length, 0);
    assert.match(texted(sheet, 5), /^Not sent: "no phone" is not a phone number/);
    assert.match(gas.spreadsheet.getSheetByName('SMSTunnel log').table()[1].join('|'), /Row 5\|no phone\|Not sent/);
  });

  test('pasting the value into 30 rows sends at most 20 texts; the rest wait', () => {
    const extra = [];
    for (let i = 0; i < 30; i++) extra.push(['P' + i, 'B-' + i, '+1415555' + String(2000 + i), 'Packing']);
    const { gas, sheet, api } = setup({ sheetRows: rows(extra) });
    edit(gas, sheet, 6, 4, 'Shipped', 30);
    assert.equal(api.sent.length, 20);
    assert.equal(gas.sleeps.length, 19, 'a pause between texts');
    assert.match(gas.spreadsheet.getSheetByName('SMSTunnel log').table().at(-1).join('|'), /Waiting\|10 more rows wait/);
    assert.equal(texted(sheet, 26), '');
    gas.run('smstunnelCheckWaitingRows', { triggerUid: 'manual' });
    assert.equal(api.sent.length, 30);
    assert.equal(new Set(api.sent.map((s) => s.to)).size, 30, 'one text per row');
  });

  test('Google Sheets dropped the +: the number cell is still read right', () => {
    const { gas, sheet, api } = setup({ input: { countryCode: '+1' } });
    sheet.getRange(3, 5).setValue('');
    edit(gas, sheet, 3, 4, 'Shipped');
    assert.equal(api.sent[0].to, '+14155550102');
  });

  test('SMSTunnel refusing one number marks that row; a server error stops the run and leaves rows waiting', () => {
    const extra = [['Ed', 'A-104', '+14155550105', 'Packing'], ['Fi', 'A-105', '+14155550106', 'Packing']];
    const api = fakeApi({
      failWith: (request) => {
        if (!request.url.endsWith('/sms/send')) return null;
        const to = JSON.parse(request.payload).to;
        if (to === '+14155550101') return { status: 400, body: { message: 'Invalid phone number format', statusCode: 400 } };
        if (to === '+14155550106') return { status: 503, body: { message: 'Service Unavailable', statusCode: 503 } };
        return null;
      },
    });
    const { gas, sheet } = setup({ http: api, sheetRows: rows(extra) });
    edit(gas, sheet, 2, 4, 'Shipped');
    assert.match(texted(sheet, 2), /^Not sent: Invalid phone number format/);
    sheet.getRange(6, 4).setValue('Shipped');
    sheet.getRange(7, 4).setValue('Shipped');
    gas.run('smstunnelCheckWaitingRows', { triggerUid: 'manual' });
    assert.equal(Object.prototype.toString.call(texted(sheet, 6)), '[object Date]');
    assert.equal(texted(sheet, 7), '', 'left for the next run');
    assert.match(gas.spreadsheet.getSheetByName('SMSTunnel log').table().at(-1).join('|'), /Stopped\|SMSTunnel could not be reached/);
  });

  test('a key that stopped working: nothing is marked, the run fails so Google tells you', () => {
    let refuse = false;
    const api = fakeApi({ failWith: (request) => (refuse && request.url.endsWith('/sms/send') ? { status: 401, body: { message: 'Invalid or expired API key', statusCode: 401 } } : null) });
    const { gas, sheet } = setup({ http: api });
    refuse = true;
    assert.throws(() => edit(gas, sheet, 2, 4, 'Shipped'), /did not accept the key/);
    assert.equal(texted(sheet, 2), '');
    assert.match(gas.userProps.getProperty('SMSTUNNEL_LAST_PROBLEM'), /did not accept the key/);
  });

  test('a renamed column stops the texts once, with a clear log line', () => {
    const { gas, sheet, api } = setup();
    sheet.getRange(1, 3).setValue('Mobile');
    edit(gas, sheet, 2, 4, 'Shipped');
    edit(gas, sheet, 4, 4, 'Shipped');
    assert.equal(api.sent.length, 0);
    const stops = gas.spreadsheet.getSheetByName('SMSTunnel log').table().filter((row) => row[4] === 'Stopped');
    assert.equal(stops.length, 1);
    assert.match(stops[0][5], /no column called "Phone"/);
  });

  test('cells from the row never turn into formulas in the log', () => {
    const { gas, sheet, api } = setup({ sheetRows: [HEADERS, ['=HYPERLINK("https://evil.test")', 'A-1', '=1+1', 'Packing']] });
    edit(gas, sheet, 2, 4, 'Shipped');
    assert.equal(api.sent.length, 0);
    for (const s of gas.spreadsheet.sheets) assert.deepEqual(s.formulas, [], s.name);
  });

  test('Send waiting texts now asks first, then texts the waiting rows', () => {
    const { gas, sheet, api } = setup();
    sheet.getRange(2, 4).setValue('Shipped');
    sheet.getRange(4, 4).setValue('Shipped');
    gas.ui.answers.push('NO');
    gas.run('smstunnelSendWaitingNow');
    assert.equal(api.sent.length, 0);
    assert.match(gas.ui.alerts.at(-1).text, /2 rows are "Shipped" with no text yet \(row 2, 4\)/);
    gas.run('smstunnelSendWaitingNow');
    assert.equal(api.sent.length, 2);
    assert.match(gas.ui.alerts.at(-1).text, /2 texts sent/);
    gas.run('smstunnelSendWaitingNow');
    assert.match(gas.ui.alerts.at(-1).title, /Nothing waiting/);
  });

  test('a stale trigger from another editor sends nothing and removes itself', () => {
    const { gas, sheet, api } = setup();
    const old = gas.triggers[0];
    gas.as('bob');
    gas.useKey('sk_live_bobs-key-0000001');
    gas.run('smstunnelSaveSetup', { apiKey: '', sheetId: String(sheet.getSheetId()), statusColumn: 'Status', statusValue: 'Ready', phoneColumn: 'Phone', message: 'Ready: {Order}', countryCode: '+40', cap: 5 });
    gas.as('owner');
    sheet.getRange(2, 4).setValue('Shipped');
    gas.run('smstunnelOnEdit', { range: sheet.getRange(2, 4), source: gas.spreadsheet, triggerUid: old.id });
    assert.equal(api.sent.length, 0);
    assert.equal(gas.triggers.some((t) => t.id === old.id), false);
  });

  test('the key never shows in the sheet, its notes, the log or the dialogs', () => {
    const { gas, sheet } = setup();
    edit(gas, sheet, 2, 4, 'Shipped');
    edit(gas, sheet, 5, 4, 'Shipped');
    gas.run('smstunnelHelp');
    gas.run('smstunnelSetUp');
    assert.equal(gas.everything().includes(KEY), false);
  });
});
