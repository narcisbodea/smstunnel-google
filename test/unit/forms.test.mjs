import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, fakeApi } from '../harness/gas.mjs';

const KEY = 'sk_live_forms-test-key-77';
const ITEMS = [
  { id: 11, title: 'Your name', type: 'TEXT' },
  { id: 12, title: 'Phone number', type: 'TEXT' },
  { id: 13, title: 'What do you need?', type: 'PARAGRAPH_TEXT' },
  { id: 14, title: 'Text me a confirmation', type: 'CHECKBOX', choices: ['Yes, text me'] },
  { id: 15, title: 'About us', type: 'SECTION_HEADER' },
  { id: 16, title: 'Size', type: 'MULTIPLE_CHOICE' },
];

function setup(http = fakeApi(), input = {}) {
  const gas = createGas({ project: 'forms-text-me', http, form: { title: 'Bike repair booking', items: ITEMS }, timeZone: 'Europe/Bucharest' });
  const result = gas.run('smstunnelSaveSetup', {
    apiKey: KEY,
    ownerNumbers: '+14155550100\n+1 415 555 0101',
    ownerMessage: 'New response to {Form}:\n{Answers}',
    confirm: true,
    phoneQuestionId: '12',
    consentQuestionId: '14',
    confirmMessage: 'Thanks {Your name}! We got your answers to {Form}.',
    countryCode: '+1',
    deviceId: '',
    ...input,
  });
  return { gas, result };
}

function submit(gas, answers, extra = {}) {
  const response = gas.form.response({ answers, ...extra });
  const trigger = gas.triggers.find((t) => t.handler === 'smstunnelOnFormSubmit' && t.user === gas.user);
  gas.run('smstunnelOnFormSubmit', { response, source: gas.form, triggerUid: trigger ? trigger.id : 'none' });
  return response;
}

describe('Set up', () => {
  test('lists the questions people answer, and the defaults', () => {
    const gas = createGas({ project: 'forms-text-me', http: fakeApi(), form: { title: 'Bike repair booking', items: ITEMS } });
    const data = gas.run('smstunnelGetSetupData');
    assert.deepEqual(data.questions.map((q) => q.title), ['Your name', 'Phone number', 'What do you need?', 'Text me a confirmation', 'Size']);
    assert.equal(data.settings.ownerMessage, 'New response to {Form}:\n{Answers}');
    assert.equal(data.on, false);
    assert.equal(data.key.saved, false);
  });

  test('saving turns the texts on: key in your user properties, one form trigger, setup claimed', () => {
    const { gas, result } = setup();
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.match(result.message, /2 of your numbers/);
    assert.equal(gas.userProps.getProperty('SMSTUNNEL_API_KEY'), KEY);
    assert.equal(gas.scriptProps.getProperty('SMSTUNNEL_API_KEY'), null);
    assert.equal(gas.documentProps.getProperty('SMSTUNNEL_API_KEY'), null);
    assert.equal(JSON.stringify(gas.documentProps.getProperties()).includes(KEY), false);
    const settings = JSON.parse(gas.userProps.getProperty('SMSTUNNEL_SETTINGS'));
    assert.deepEqual(settings.ownerNumbers, ['+14155550100', '+14155550101']);
    assert.equal(JSON.stringify(settings).includes(KEY), false);
    assert.deepEqual(gas.triggers.map((t) => [t.handler, t.event, t.source]), [['smstunnelOnFormSubmit', 'ON_FORM_SUBMIT', 'FORMS']]);
    assert.ok(gas.scopeChecks.length >= 1, 'asks for all permissions before making the trigger');
    assert.equal(gas.run('smstunnelGetSetupData').on, true);
    // Saving again replaces the trigger instead of adding one.
    gas.run('smstunnelSaveSetup', { ...JSON.parse(JSON.stringify(settings)), ownerNumbers: '+14155550100', apiKey: '' });
    assert.equal(gas.triggers.length, 1);
  });

  test('checks every field', () => {
    const { result } = setup(fakeApi(), {
      ownerNumbers: '',
      ownerMessage: 'New {Nope}',
      phoneQuestionId: '13',
      consentQuestionId: '13',
      confirmMessage: '',
      countryCode: 'RO',
      deviceId: 'bad id!',
    });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors).sort(), ['confirmMessage', 'consentQuestionId', 'countryCode', 'deviceId', 'ownerMessage', 'ownerNumbers', 'phoneQuestionId'].sort());
    assert.match(result.errors.phoneQuestionId, /short-answer/);
    assert.match(result.errors.ownerMessage, /\{Nope\}/);
  });

  test('a key SMSTunnel refuses is not saved', () => {
    const { gas, result } = setup(() => ({ status: 401, body: { message: 'Invalid or expired API key', statusCode: 401 } }));
    assert.equal(result.ok, false);
    assert.match(result.errors.apiKey, /did not accept the key/);
    assert.equal(gas.userProps.getProperty('SMSTUNNEL_API_KEY'), null);
    assert.equal(gas.triggers.length, 0);
  });

  test('more than 5 of your numbers is refused', () => {
    const { result } = setup(fakeApi(), { ownerNumbers: ['+14155550101', '+14155550102', '+14155550103', '+14155550104', '+14155550105', '+14155550106'].join('\n') });
    assert.match(result.errors.ownerNumbers, /Up to 5/);
  });
});

describe('each response', () => {
  test('one text to each of your numbers, and a confirmation when the box is ticked', () => {
    const api = fakeApi();
    const { gas } = setup(api);
    submit(gas, { 'Your name': 'Ana', 'Phone number': '(415) 555-0199', 'What do you need?': 'New brakes', 'Text me a confirmation': ['Yes, text me'] });
    assert.deepEqual(api.sent.map((s) => s.to), ['+14155550100', '+14155550101', '+14155550199']);
    assert.equal(api.sent[0].message, 'New response to Bike repair booking:\nYour name: Ana\nPhone number: (415) 555-0199\nWhat do you need?: New brakes\nText me a confirmation: Yes, text me');
    assert.equal(api.sent[2].message, 'Thanks Ana! We got your answers to Bike repair booking.');
    const recent = JSON.parse(gas.userProps.getProperty('SMSTUNNEL_RECENT'));
    assert.deepEqual(recent.map((r) => [r.kind, r.result]), [['confirmation', 'Sent'], ['you', 'Sent'], ['you', 'Sent']]);
  });

  test('no confirmation without the consent tick, an empty phone answer or a bad number', () => {
    const api = fakeApi();
    const { gas } = setup(api);
    submit(gas, { 'Your name': 'Bo', 'Phone number': '+14155550198' });
    submit(gas, { 'Your name': 'Cy', 'Text me a confirmation': ['Yes, text me'] });
    submit(gas, { 'Your name': 'Di', 'Phone number': 'call me maybe', 'Text me a confirmation': ['Yes, text me'] });
    assert.equal(api.sent.length, 6, 'only the texts to you');
    assert.ok(api.sent.every((s) => s.to === '+14155550100' || s.to === '+14155550101'));
    const reasons = JSON.parse(gas.userProps.getProperty('SMSTUNNEL_RECENT')).filter((r) => r.kind === 'confirmation').map((r) => r.details);
    assert.match(reasons[2], /consent question was not ticked/);
    assert.match(reasons[1], /phone question was left empty/);
    assert.match(reasons[0], /not a phone number/);
  });

  test('without a consent question, the number is enough', () => {
    const api = fakeApi();
    const { gas } = setup(api, { consentQuestionId: '' });
    submit(gas, { 'Your name': 'Ed', 'Phone number': '+14155550197' });
    assert.equal(api.sent.at(-1).to, '+14155550197');
  });

  test('an edited response: a new text to you marked "Edited", no second confirmation', () => {
    const api = fakeApi();
    const { gas } = setup(api);
    const answers = { 'Your name': 'Ana', 'Phone number': '+14155550199', 'Text me a confirmation': ['Yes, text me'] };
    submit(gas, answers, { id: 'resp-1' });
    submit(gas, { ...answers, 'What do you need?': 'Also a bell' }, { id: 'resp-1' });
    assert.equal(api.sent.length, 5);
    assert.match(api.sent[3].message, /^Edited: New response/);
    assert.equal(api.sent.filter((s) => s.to === '+14155550199').length, 1);
  });

  test('{Time}, {Email}, skipped questions and a long text', () => {
    const api = fakeApi();
    const { gas } = setup(api, { ownerMessage: '{Time} {Email} [{Size}] {What do you need?}', confirm: false });
    submit(gas, { 'What do you need?': 'x'.repeat(3000) }, { email: 'ana@example.com', timestamp: new Date('2026-11-02T07:30:00Z') });
    assert.match(api.sent[0].message, /^2026-11-02 09:30 ana@example\.com \[\] x+…$/);
    assert.ok(api.sent[0].message.length <= 1600);
  });

  test('a form changed since Set up: your text keeps the old {name}, the confirmation is held back', () => {
    const api = fakeApi();
    const { gas } = setup(api, { confirmMessage: 'Thanks {Your name}!' });
    gas.form.items[0].title = 'Full name';
    submit(gas, { 'Full name': 'Ana', 'Phone number': '+14155550199', 'Text me a confirmation': ['Yes, text me'] });
    assert.equal(api.sent.length, 2);
    const last = JSON.parse(gas.userProps.getProperty('SMSTUNNEL_RECENT'))[0];
    assert.match(last.details, /uses \{Your name\}, which this form no longer has/);
  });

  test('another editor set it up since: the old trigger sends nothing and removes itself', () => {
    const api = fakeApi();
    const { gas } = setup(api);
    const ownerTrigger = gas.triggers[0];
    gas.as('bob');
    gas.run('smstunnelSaveSetup', { apiKey: 'sk_live_bobs-key-0000001', ownerNumbers: '+14155550150', ownerMessage: 'Bob: {Form}', confirm: false, countryCode: '' });
    gas.as('owner');
    gas.run('smstunnelOnFormSubmit', { response: gas.form.response({ answers: { 'Your name': 'Ana' } }), source: gas.form, triggerUid: ownerTrigger.id });
    assert.equal(api.sent.length, 0);
    assert.equal(gas.triggers.some((t) => t.id === ownerTrigger.id), false);
    gas.as('bob');
    submit(gas, { 'Your name': 'Ana' });
    assert.deepEqual(api.sent.map((s) => s.to), ['+14155550150']);
  });

  test('a busy server is tried once more after a short wait', () => {
    let calls = 0;
    const api = fakeApi({
      failWith: (request) => {
        if (!request.url.endsWith('/sms/send')) return null;
        calls++;
        return calls === 1 ? { status: 429, headers: { 'Retry-After': '7' }, body: { statusCode: 429, message: 'Too Many Requests' } } : null;
      },
    });
    const { gas } = setup(api, { ownerNumbers: '+14155550100', confirm: false });
    submit(gas, { 'Your name': 'Ana' });
    assert.equal(api.sent.length, 1);
    assert.deepEqual(gas.sleeps, [7000]);
  });

  test('a key that stopped working: the run fails (Google emails you), and the problem shows in Help', () => {
    let refuse = false;
    const api = fakeApi({ failWith: (request) => (refuse && request.url.endsWith('/sms/send') ? { status: 401, body: { message: 'Invalid or expired API key', statusCode: 401 } } : null) });
    const { gas } = setup(api);
    refuse = true;
    assert.throws(() => submit(gas, { 'Your name': 'Ana', 'Phone number': '+14155550199', 'Text me a confirmation': ['Yes, text me'] }), /did not accept the key/);
    assert.equal(gas.requests.filter((r) => r.url.endsWith('/sms/send')).length, 1, 'stops at the first refusal');
    gas.run('smstunnelHelp');
    assert.match(gas.ui.dialogs.at(-1).html, /Last problem/);
  });

  test('consent comes only from a checkbox, and only its first box means yes', () => {
    const choice = setup(fakeApi(), { consentQuestionId: '16' });
    assert.match(choice.result.errors.consentQuestionId, /checkbox question/);
    const api = fakeApi();
    const gas = createGas({
      project: 'forms-text-me',
      http: api,
      form: { title: 'Booking', items: [{ id: 1, title: 'Phone' }, { id: 2, title: 'Texts', type: 'CHECKBOX', choices: ['Yes, text me', 'Call me instead'] }] },
    });
    const saved = gas.run('smstunnelSaveSetup', { apiKey: KEY, ownerNumbers: '+14155550100', ownerMessage: 'New: {Form}', confirm: true, phoneQuestionId: '1', consentQuestionId: '2', confirmMessage: 'Thanks', countryCode: '' });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
    assert.match(saved.message, /when they tick "Yes, text me"/);
    const trigger = gas.triggers[0];
    gas.run('smstunnelOnFormSubmit', { response: gas.form.response({ answers: { Phone: '+14155550191', Texts: ['Call me instead'] } }), source: gas.form, triggerUid: trigger.id });
    assert.deepEqual(api.sent.map((s) => s.to), ['+14155550100'], 'the other box is not consent');
    gas.run('smstunnelOnFormSubmit', { response: gas.form.response({ answers: { Phone: '+14155550192', Texts: ['Call me instead', 'Yes, text me'] } }), source: gas.form, triggerUid: trigger.id });
    assert.equal(api.sent.at(-1).to, '+14155550192');
  });

  test('{Time} uses the time zone chosen in Set up', () => {
    const api = fakeApi();
    const { gas } = setup(api, { ownerMessage: 'At {Time}', confirm: false, timeZone: 'America/New_York' });
    submit(gas, { 'Your name': 'Ana' }, { timestamp: new Date('2026-11-02T14:30:00Z') });
    assert.equal(api.sent[0].message, 'At 2026-11-02 09:30');
    const bad = setup(fakeApi(), { timeZone: 'Mars/Olympus Mons!' });
    assert.match(bad.result.errors.timeZone, /time zone like/);
  });

  test('each text carries an Idempotency-Key, and the retry after a busy server sends the same one', () => {
    let calls = 0;
    const api = fakeApi({
      failWith: (request) => {
        if (!request.url.endsWith('/sms/send')) return null;
        calls++;
        return calls === 1 ? { status: 503, body: { message: 'busy', statusCode: 503 } } : null;
      },
    });
    const { gas } = setup(api, { ownerNumbers: '+14155550100\n+14155550101', confirm: false });
    submit(gas, { 'Your name': 'Ana' });
    const keys = gas.requests.filter((r) => r.url.endsWith('/sms/send')).map((r) => r.headers['Idempotency-Key']);
    assert.equal(keys.length, 3);
    assert.match(keys[0], /^smstunnel-gas-[A-Za-z0-9_-]{43}$/);
    assert.equal(keys[0], keys[1], 'the retry reuses the key');
    assert.notEqual(keys[1], keys[2], 'another number, another key');
  });

  test('long answers never make Recent texts too big for its property (9 kB)', () => {
    const api = fakeApi();
    const { gas } = setup(api);
    for (let i = 0; i < 25; i++) {
      submit(gas, { 'Your name': 'Ana ' + i, 'Phone number': 'ç'.repeat(3000), 'Text me a confirmation': ['Yes, text me'] });
    }
    const stored = gas.userProps.getProperty('SMSTUNNEL_RECENT');
    assert.ok(Buffer.byteLength(stored) <= 8000, Buffer.byteLength(stored) + ' bytes');
    assert.equal(api.sent.length, 50, 'your texts all went out');
    assert.match(JSON.parse(stored)[0].details, /not a phone number/);
  });

  test('templates longer than a text are refused at setup', () => {
    const { result } = setup(fakeApi(), { ownerMessage: 'x'.repeat(1601), confirmMessage: 'y'.repeat(1601) });
    assert.match(result.errors.ownerMessage, /too long/);
    assert.match(result.errors.confirmMessage, /too long/);
  });

  test('what respondents type is escaped in Recent texts', () => {
    const { gas } = setup();
    submit(gas, { 'Your name': 'Ana', 'Phone number': '<img src=x onerror=alert(1)>', 'Text me a confirmation': ['Yes, text me'] });
    gas.run('smstunnelRecentTexts');
    const html = gas.ui.dialogs.at(-1).html;
    assert.equal(html.includes('<img src=x'), false);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('the key never shows in logs, recent texts or dialogs', () => {
    const api = fakeApi({ failWith: (request) => (request.url.endsWith('/sms/send') && JSON.parse(request.payload).to.endsWith('99') ? { throw: 'DNS error' } : null) });
    const { gas } = setup(api);
    submit(gas, { 'Your name': 'Ana', 'Phone number': '+14155550199', 'Text me a confirmation': ['Yes, text me'] });
    gas.run('smstunnelRecentTexts');
    gas.run('smstunnelHelp');
    const everything = gas.everything() + gas.userProps.getProperty('SMSTUNNEL_RECENT');
    assert.equal(everything.includes(KEY), false);
    assert.match(gas.ui.dialogs.at(-2).html, /could not be reached/);
  });
});

describe('the menu', () => {
  test('onOpen adds the SMSTunnel menu, whose items are all functions of the project', () => {
    const { gas } = setup();
    gas.run('onOpen');
    const menu = gas.ui.menus[0];
    assert.equal(menu.name, 'SMSTunnel');
    for (const item of menu.items.filter((i) => !i.separator)) assert.equal(typeof gas.context[item.fn], 'function', item.fn);
  });

  test('Set up opens the dialog; Turn texts off removes the trigger', () => {
    const { gas } = setup();
    gas.run('smstunnelSetUp');
    assert.match(gas.ui.dialogs.at(-1).html, /Save and turn on/);
    gas.run('smstunnelTurnOff');
    assert.equal(gas.triggers.length, 0);
    assert.equal(gas.run('smstunnelGetSetupData').on, false);
  });

  test('Send a test text offers your first number', () => {
    const api = fakeApi();
    const { gas } = setup(api);
    gas.ui.promptAnswers.push({ button: 'OK', text: '' });
    gas.run('smstunnelSendTestText');
    assert.match(gas.ui.prompts[0].text, /\+14155550100/);
    assert.equal(api.sent[0].to, '+14155550100');
  });
});
