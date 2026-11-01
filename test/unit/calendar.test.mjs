import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi, zoned } from '../harness/gas.mjs';

const KEY = 'sk_live_calendar-test-0001';
const TZ = 'America/New_York';
const at = (d, h, m = 0, month = 11) => zoned(2026, month, d, h, m, 0, TZ);
const NOW = at(2, 8, 50); // Monday 2 Nov 2026, 8:50 AM in New York
const min = (n) => n * 60000;

function calendars() {
  return [
    {
      id: 'me@example.com',
      name: 'Narcis',
      timeZone: TZ,
      primary: true,
      events: [
        { id: 'standup', title: 'Standup', start: at(2, 8, 30) },
        { id: 'dentist', title: 'Dentist', start: at(2, 9, 0), location: 'Main St 5' },
        { id: 'gym', title: 'Gym', start: at(2, 9, 5), recurring: true },
        { id: 'gym', title: 'Gym', start: at(3, 9, 5), recurring: true },
        { id: 'call', title: 'Call with Ana', start: at(2, 9, 40) },
        { id: 'lunch', title: 'Lunch with Bo', start: at(2, 12, 0), myStatus: 'NO' },
        { id: 'bday', title: "Ana's birthday", allDay: '2026-11-02' },
      ],
    },
    {
      id: 'work@group.calendar.google.com',
      name: 'Appointments',
      timeZone: TZ,
      events: [
        { id: 'c-haircut', title: 'Haircut', start: new Date(NOW.getTime() + min(20 * 60)), description: 'Client: Ana\nSMS: +1 415 555 0123' },
        {
          id: 'c-consult',
          title: 'Consultation',
          start: new Date(NOW.getTime() + min(5 * 60)),
          description: 'Hello<br>Phone number: <a href="tel:+14155550124">+1 415-555-0124</a><br>Dial-in: +1 646 558 8656,,123456#<br>Office phone is 415 555 0000',
        },
        { id: 'c-physio', title: 'Physio', start: new Date(NOW.getTime() + min(3 * 60)), guests: [{ email: 'BO@example.com', name: 'Bo' }, { email: 'cy@example.com', status: 'NO' }, { email: 'stranger@example.com' }] },
        { id: 'c-bad', title: 'Fitting', start: new Date(NOW.getTime() + min(4 * 60)), description: 'SMS: call me' },
        { id: 'c-later', title: 'Later', start: new Date(NOW.getTime() + min(30 * 60)), description: 'SMS: +14155550125' },
        { id: 'c-allday', title: 'Closed', allDay: '2026-11-02', description: 'SMS: +14155550126' },
      ],
    },
  ];
}

const PHONE_BOOK = [
  ['Email', 'Phone', 'Name', 'Note'],
  ['bo@example.com', '+14155550131', 'Bo B.', 'asked for texts'],
  ['cy@example.com', '+14155550132', 'Cy', ''],
];

function setup({ http = fakeApi(), input = {}, book = PHONE_BOOK, cals = calendars() } = {}) {
  const gas = createGas({
    project: 'calendar-reminders',
    http,
    timeZone: TZ,
    calendars: cals,
    spreadsheet: { name: 'Calendar texts', timeZone: TZ, sheets: [{ name: 'Start here', rows: [['Open SMSTunnel → Set up']] }, { name: 'Phone numbers', rows: book }] },
  });
  const base = {
    apiKey: KEY,
    deviceId: '',
    ownerNumbers: '+14155550100\n+14155550101',
    countryCode: '+1',
    dateStyle: 'us',
    cap: 25,
    me: { on: true, calendars: ['me@example.com'], keyword: '', lead: 15, allDay: false, allDayHour: 8, message: 'Reminder: {Title} at {Time} ({In})' },
    agenda: { on: false, hour: 7, minute: 0, skipEmpty: true },
    clients: { on: false, calendars: ['work@group.calendar.google.com'], hours: 24, labels: 'SMS, Phone, Mobile', fromDescription: true, fromGuests: true, quietFrom: 8, quietTo: 21, message: 'Hi {Name}, reminder: {Title} on {Date} at {Time}.' },
  };
  const merged = {
    ...base,
    ...input,
    me: { ...base.me, ...(input.me || {}) },
    agenda: { ...base.agenda, ...(input.agenda || {}) },
    clients: { ...base.clients, ...(input.clients || {}) },
  };
  const result = gas.run('smstunnelSaveSetup', merged);
  const settings = () => gas.run('smstunnelSettingsWithDefaults_', JSON.parse(gas.userProps.getProperty('SMSTUNNEL_SETTINGS')));
  const run = (now = NOW, opts = {}) => gas.run('smstunnelRun_', settings(), now, opts);
  return { gas, result, run, settings, api: http };
}

const texts = (api) => api.sent.map((s) => [s.to, s.message]);

describe('Set up', () => {
  test('lists your calendars, main one first and chosen by default', () => {
    const gas = createGas({ project: 'calendar-reminders', http: fakeApi(), timeZone: TZ, calendars: calendars().reverse(), spreadsheet: { sheets: [{ name: 'Start here' }] } });
    const data = gas.run('smstunnelGetSetupData');
    assert.deepEqual(data.calendars.map((c) => c.name), ['Narcis', 'Appointments']);
    assert.deepEqual([...data.settings.me.calendars], ['me@example.com']);
    assert.equal(data.settings.me.on, true);
    assert.equal(data.settings.me.message, 'Reminder: {Title} at {Time} ({In})');
    assert.equal(data.on, false);
  });

  test('saving turns it on with a trigger as frequent as the shortest reminder needs', () => {
    for (const [input, expected] of [
      [{ me: { lead: 15 } }, { everyMinutes: 5 }],
      [{ me: { lead: 30 } }, { everyMinutes: 10 }],
      [{ me: { lead: 120 } }, { everyMinutes: 15 }],
      [{ me: { on: false }, agenda: { on: true } }, { everyMinutes: 15 }],
      [{ me: { on: false }, clients: { on: true } }, { everyHours: 1 }],
    ]) {
      const { gas, result } = setup({ input });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      const [trigger] = gas.triggers;
      assert.equal(trigger.handler, 'smstunnelCheckCalendar');
      for (const [k, v] of Object.entries(expected)) assert.equal(trigger[k], v, JSON.stringify(input));
    }
  });

  test('the "Phone numbers" sheet is made when guests are a source', () => {
    const gas = createGas({ project: 'calendar-reminders', http: fakeApi(), timeZone: TZ, calendars: calendars(), spreadsheet: { sheets: [{ name: 'Start here' }] } });
    const out = gas.run('smstunnelSaveSetup', {
      apiKey: KEY, ownerNumbers: '', me: { on: false }, agenda: { on: false },
      clients: { on: true, calendars: ['work@group.calendar.google.com'], hours: 24, labels: 'SMS', fromDescription: true, fromGuests: true, quietFrom: 8, quietTo: 21, message: 'Reminder: {Title}' },
      cap: 25,
    });
    assert.equal(out.ok, true, JSON.stringify(out.errors));
    assert.deepEqual(gas.spreadsheet.getSheetByName('Phone numbers').table()[0], ['Email', 'Phone', 'Name', 'Note']);
  });

  test('checks what matters for the parts that are on', () => {
    const none = setup({ input: { me: { on: false }, agenda: { on: false }, clients: { on: false } } });
    assert.match(none.result.errors.parts, /at least one/);
    const bad = setup({
      input: {
        ownerNumbers: '',
        me: { calendars: [], message: 'Hi {Nope}', lead: 7 },
        clients: { on: true, calendars: ['gone'], hours: 5, fromDescription: false, fromGuests: false, quietFrom: 22, quietTo: 6, message: '' },
        cap: 0,
      },
    });
    assert.deepEqual(Object.keys(bad.result.errors).sort(), ['cap', 'clientCalendars', 'clientHours', 'clientMessage', 'clientQuiet', 'clientSources', 'meCalendars', 'meLead', 'meMessage', 'ownerNumbers'].sort());
    assert.match(bad.result.errors.meMessage, /\{Nope\}/);
  });
});

describe('remind me', () => {
  test('a text to each of your numbers, the given time before each event', () => {
    const { run, api } = setup();
    const outcome = run();
    assert.equal(outcome.sent, 4);
    assert.deepEqual(texts(api), [
      ['+14155550100', 'Reminder: Dentist at 9:00 AM (in 10 min)'],
      ['+14155550101', 'Reminder: Dentist at 9:00 AM (in 10 min)'],
      ['+14155550100', 'Reminder: Gym at 9:05 AM (in 15 min)'],
      ['+14155550101', 'Reminder: Gym at 9:05 AM (in 15 min)'],
    ]);
  });

  test('never twice; the next event when its time comes; a moved event gets one new text', () => {
    const { run, api, gas } = setup();
    run();
    assert.equal(run(new Date(NOW.getTime() + min(5))).sent, 0);
    const call = run(at(2, 9, 26));
    assert.equal(call.sent, 2);
    assert.match(api.sent.at(-1).message, /Call with Ana at 9:40 AM \(in 14 min\)/);
    gas.calendars[0].events.find((e) => e.spec.id === 'dentist').start = at(2, 10, 0);
    assert.equal(run(at(2, 9, 30)).sent, 0);
    const moved = run(at(2, 9, 50));
    assert.equal(moved.sent, 2);
    assert.match(api.sent.at(-1).message, /Dentist at 10:00 AM/);
  });

  test('each day of a recurring event is reminded', () => {
    const { run, api } = setup({ input: { me: { keyword: 'gym' } } });
    run();
    run(at(3, 8, 55));
    assert.deepEqual(api.sent.map((s) => s.message), ['Reminder: Gym at 9:05 AM (in 15 min)', 'Reminder: Gym at 9:05 AM (in 15 min)', 'Reminder: Gym at 9:05 AM (in 10 min)', 'Reminder: Gym at 9:05 AM (in 10 min)']);
  });

  test('only events whose title has the keyword; declined events and started ones never', () => {
    const { run, api } = setup({ input: { me: { keyword: 'dentist, lunch', lead: 1440 } } });
    run();
    assert.deepEqual([...new Set(api.sent.map((s) => s.message))], ['Reminder: Dentist at 9:00 AM (in 10 min)']);
  });

  test('all-day events only when you include them, as if they started at the hour you chose', () => {
    const off = setup();
    assert.equal(off.run(at(2, 7, 50)).sent, 0);
    const on = setup({ input: { me: { allDay: true, allDayHour: 8 } } });
    on.run(at(2, 7, 50));
    assert.deepEqual([...new Set(on.api.sent.map((s) => s.message))], ["Reminder: Ana's birthday at all day (in 10 min)"]);
  });
});

describe('my agenda', () => {
  test('one text at the hour you chose with the day\'s events, in order', () => {
    const { run, api } = setup({ input: { me: { on: false }, agenda: { on: true, hour: 7, minute: 0 } } });
    assert.equal(run(at(2, 6, 55)).sent, 0);
    assert.equal(run(at(2, 7, 5)).sent, 2);
    assert.equal(api.sent[0].message, 'Today, Mon, Nov 2:\n8:30 AM Standup\n9:00 AM Dentist\n9:05 AM Gym\n9:40 AM Call with Ana');
    assert.equal(run(at(2, 7, 20)).sent, 0, 'once a day');
    assert.equal(run(at(3, 7, 10)).sent, 2, 'and again the next day');
    assert.equal(api.sent.at(-1).message, 'Today, Tue, Nov 3:\n9:05 AM Gym');
  });

  test('all-day events listed when included; empty days skipped; no agenda long after its hour', () => {
    const withAllDay = setup({ input: { me: { on: false, allDay: true }, agenda: { on: true, hour: 7 } } });
    withAllDay.run(at(2, 7, 1));
    assert.match(withAllDay.api.sent[0].message, /^Today, Mon, Nov 2:\nAll day: Ana's birthday\n8:30 AM Standup/);
    const empty = setup({ input: { me: { on: false }, agenda: { on: true, hour: 7 } } });
    assert.equal(empty.run(at(4, 7, 1)).sent, 0);
    const late = setup({ input: { me: { on: false }, agenda: { on: true, hour: 7 } } });
    assert.equal(late.run(at(2, 10, 30)).sent, 0);
    const told = setup({ input: { me: { on: false }, agenda: { on: true, hour: 7, skipEmpty: false } } });
    told.run(at(4, 7, 1));
    assert.equal(told.api.sent[0].message, 'Today, Wed, Nov 4: nothing on your calendar.');
  });
});

describe('reminders to the people in your events', () => {
  const clientsOnly = { me: { on: false }, clients: { on: true } };

  test('numbers from "SMS:" or "Phone number:" lines and from guests in the "Phone numbers" sheet', () => {
    const { run, api, gas } = setup({ input: clientsOnly });
    const outcome = run();
    assert.equal(outcome.sent, 3);
    assert.deepEqual(texts(api), [
      ['+14155550131', 'Hi Bo B., reminder: Physio on Mon, Nov 2 at 11:50 AM.'],
      ['+14155550124', 'Hi, reminder: Consultation on Mon, Nov 2 at 1:50 PM.'],
      ['+14155550123', 'Hi, reminder: Haircut on Tue, Nov 3 at 4:50 AM.'],
    ]);
    assert.equal(outcome.notSent, 1);
    const log = gas.spreadsheet.getSheetByName('SMSTunnel log').table();
    assert.match(log.find((row) => row[4] === 'Not sent').join('|'), /Fitting.*call me.*not a phone number/);
    assert.equal(api.sent.some((s) => s.to.includes('6465588656') || s.to.endsWith('0000')), false, 'other numbers in a description are left alone');
  });

  test('never twice, a bad number is logged once, and nothing at night', () => {
    const { run, gas } = setup({ input: clientsOnly });
    run();
    const again = run(new Date(NOW.getTime() + min(60)));
    assert.equal(again.sent + again.notSent, 0);
    assert.equal(gas.spreadsheet.getSheetByName('SMSTunnel log').table().filter((row) => row[4] === 'Not sent').length, 1);
    const night = setup({ input: clientsOnly });
    assert.equal(night.run(at(2, 22, 0)).sent, 0);
  });

  test('at most 10 people per event', () => {
    const book = [['Email', 'Phone', 'Name']];
    const guests = [];
    for (let i = 0; i < 12; i++) {
      book.push([`p${i}@example.com`, '+1415555' + String(3000 + i), 'P' + i]);
      guests.push({ email: `p${i}@example.com` });
    }
    const cals = calendars();
    cals[1].events = [{ id: 'class', title: 'Class', start: new Date(NOW.getTime() + min(120)), guests }];
    const { run, api } = setup({ input: clientsOnly, book, cals });
    const outcome = run();
    assert.equal(outcome.sent, 10);
    assert.equal(outcome.notSent, 1);
    assert.equal(new Set(api.sent.map((s) => s.to)).size, 10);
  });

  test('the per-check cap holds across every kind of text', () => {
    const { run } = setup({ input: { clients: { on: true }, cap: 3 } });
    const outcome = run();
    assert.equal(outcome.sent, 3);
    assert.ok(outcome.waiting >= 4);
    assert.equal(run(new Date(NOW.getTime() + 1000)).sent, 3);
  });
});

describe('the menu and the trigger', () => {
  test('Preview lists the texts of the next 24 hours and sends nothing', () => {
    const { gas, api } = setup({ input: { clients: { on: true }, agenda: { on: true } } });
    gas.run('smstunnelPreview');
    assert.equal(api.sent.length, 0);
    const html = gas.ui.dialogs.at(-1).html;
    assert.match(html, /Nothing is sent from this window/);
    assert.match(html, /Reminder: Call with Ana/);
    assert.match(html, /Hi Bo B\., reminder: Physio/);
    assert.match(html, /Your agenda for today/);
  });

  test('the dialog\'s test button uses what is typed, even a key not saved yet', () => {
    const gas = createGas({ project: 'calendar-reminders', http: fakeApi(), timeZone: TZ, calendars: calendars(), spreadsheet: { sheets: [{ name: 'Start here' }] } });
    const out = gas.run('smstunnelSendTestReminder', {
      apiKey: 'sk_live_typed-not-saved-1',
      ownerNumbers: '+1 415 555 0177',
      me: { on: true, calendars: ['me@example.com'], lead: 15, message: 'Reminder: {Title} at {Time} ({In})' },
      agenda: {},
      clients: {},
    });
    assert.equal(out.ok, true, JSON.stringify(out));
    const send = gas.requests.find((r) => r.url.endsWith('/sms/send'));
    assert.equal(send.headers['X-API-Key'], 'sk_live_typed-not-saved-1');
    assert.equal(JSON.parse(send.payload).to, '+14155550177');
    assert.match(JSON.parse(send.payload).message, /^Test: Reminder: /);
    assert.equal(gas.userProps.getProperty('SMSTUNNEL_API_KEY'), null, 'testing does not save the key');
    const missing = gas.run('smstunnelSendTestReminder', { apiKey: 'sk_live_typed-not-saved-1', ownerNumbers: '', me: { message: 'x', lead: 15 } });
    assert.match(missing.errors.ownerNumbers, /Add your own number/);
  });

  test('with no event in the next 7 days, the test reminder is a made-up one', () => {
    const empty = [{ id: 'me@example.com', name: 'Narcis', timeZone: TZ, primary: true, events: [] }];
    const { gas, api } = setup({ cals: empty });
    gas.run('smstunnelTestReminder');
    assert.match(api.sent[0].message, /^Test: Reminder: Dentist at /);
    assert.match(gas.ui.alerts.at(-1).text, /made up/);
  });

  test('the trigger checks the calendar; a stale one removes itself; a dead key makes the run fail', () => {
    let refuse = false;
    const api = fakeApi({ failWith: (request) => (refuse && request.url.endsWith('/sms/send') ? { status: 401, body: { message: 'Invalid or expired API key', statusCode: 401 } } : null) });
    const cals = calendars();
    cals[0].events.push({ id: 'soon', title: 'Soon', start: new Date(Date.now() + min(10)) });
    const { gas } = setup({ http: api, cals });
    const trigger = gas.triggers[0];
    gas.run('smstunnelCheckCalendar', { triggerUid: trigger.id });
    assert.deepEqual([...new Set(api.sent.map((s) => s.message.replace(/\(in \d+ min\)/, '(in N min)')))].length, 1);
    refuse = true;
    gas.calendars[0].add({ id: 'soon2', title: 'Soon 2', start: new Date(Date.now() + min(12)) }, TZ);
    assert.throws(() => gas.run('smstunnelCheckCalendar', { triggerUid: trigger.id }), /did not accept the key/);
    gas.run('smstunnelTurnOff');
    gas.triggers.push({ ...trigger, getUniqueId: () => trigger.id, getHandlerFunction: () => trigger.handler });
    gas.run('smstunnelCheckCalendar', { triggerUid: trigger.id });
    assert.equal(gas.triggers.length, 0, 'a trigger left from a turned-off setup removes itself');
  });

  test('onOpen adds the menu and, before setup, a hint', () => {
    const gas = createGas({ project: 'calendar-reminders', http: fakeApi(), timeZone: TZ, calendars: calendars(), spreadsheet: { sheets: [{ name: 'Start here' }] } });
    gas.run('onOpen');
    assert.deepEqual(gas.ui.menus[0].items.filter((i) => !i.separator).map((i) => i.caption), ['Set up', 'Send me a test reminder', 'Preview the next texts', 'Send due texts now', 'Turn texts off', 'Help']);
    assert.match(gas.spreadsheet.toasts[0].text, /Set up/);
  });

  test('the sent store forgets events more than 3 days old, once a day', () => {
    const { run, gas } = setup();
    run();
    const sent = gas.spreadsheet.getSheetByName('SMSTunnel sent');
    assert.equal(sent.getLastRow(), 5);
    assert.equal(sent.isSheetHidden(), true);
    gas.userProps.deleteProperty('SMSTUNNEL_PRUNED');
    run(new Date(NOW.getTime() + 4 * 86400000));
    assert.equal(sent.getLastRow(), 1);
  });

  test('the key never shows in the sheets, the log or the dialogs', () => {
    const { gas, run } = setup({ input: { clients: { on: true } } });
    run();
    gas.run('smstunnelPreview');
    gas.run('smstunnelHelp');
    gas.run('smstunnelSetUp');
    assert.equal(gas.everything().includes(KEY), false);
    for (const sheet of gas.spreadsheet.sheets) assert.deepEqual(sheet.formulas, [], sheet.name);
  });
});

describe('reading descriptions', () => {
  const gas = createGas({ project: 'calendar-reminders', http: fakeApi(), timeZone: TZ, calendars: calendars(), spreadsheet: { sheets: [{ name: 'x' }] } });
  const read = (text, labels = ['sms', 'phone', 'mobile']) => [...gas.run('smstunnelNumbersInDescription_', text, labels)];
  test('labels, case, "number", full-width colons and HTML', () => {
    assert.deepEqual(read('SMS: +1 415 555 0123'), ['+1 415 555 0123']);
    assert.deepEqual(read('mobile number : 0722 123 456 (Ana)'), ['0722 123 456 (']);
    assert.deepEqual(read('Phone：+40 722 000 111'), ['+40 722 000 111']);
    assert.deepEqual(read('<p>Phone: <a href="tel:+14155550123">+1&nbsp;415&nbsp;555&nbsp;0123</a></p>'), ['+1 415 555 0123']);
    assert.deepEqual(read('Notes&#58; none<br/>SMS&#58; +14155550123'), ['+14155550123']);
  });
  test('other numbers are left alone', () => {
    assert.deepEqual(read('Join by phone +1 646 558 8656\nMeeting ID: 123 456 789\nCall +14155550123\nOffice phone: +14155550000'), []);
    assert.deepEqual(read('Tel: +14155550123'), []);
    assert.deepEqual(read('Tel: +14155550123', ['tel']), ['+14155550123']);
    assert.deepEqual(read(''), []);
  });
});
