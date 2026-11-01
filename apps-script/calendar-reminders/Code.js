/**
 * SMSTunnel for Google Calendar · https://smstunnel.io
 *
 * Text reminders for your Google Calendar, from your own Android phone and your own number:
 *  - "Remind me": a text to your own number(s) a few minutes or hours before each event, in the calendars you
 *    choose (optionally only events whose title has a word you choose);
 *  - "My agenda": one text each morning with the day's events;
 *  - reminders to the people in your events: the number on a line like "SMS: +1 415 555 0123" in the event's
 *    description, or a guest's number from the "Phone numbers" sheet, N hours before.
 * Each text goes out once per event and number; an event that moves gets one new text for its new time.
 *
 * This script lives in a spreadsheet, which keeps the log and the guests' numbers. SMSTunnel menu → Set up.
 *
 * MIT License · Copyright (c) 2026 NARBOWEB SRL
 */
var SMSTUNNEL_APP = {
  name: 'SMSTunnel for Google Calendar',
  short: 'Calendar',
  host: 'sheets',
  handlers: ['smstunnelCheckCalendar'],
};

var SMSTUNNEL_CALENDAR = {
  maxOwnerNumbers: 5,
  perEvent: 10,
  defaultCap: 25,
  maxCap: 100,
  agendaWindowHours: 3,
  keepSentDays: 3,
  phoneBookSheet: 'Phone numbers',
  phoneBookHeaders: ['Email', 'Phone', 'Name', 'Note'],
  meMessage: 'Reminder: {Title} at {Time} ({In})',
  clientMessage: 'Reminder: your appointment on {Date} at {Time}. Reply to this text if you need to change it.',
  labels: 'SMS, Phone, Mobile',
  leads: [10, 15, 30, 45, 60, 120, 180, 360, 720, 1440],
  clientHours: [1, 2, 3, 6, 12, 24, 48, 72],
  agendaMinutes: [0, 15, 30, 45],
  placeholders: ['Title', 'Date', 'Time', 'Location', 'Calendar', 'In', 'Name'],
  dateStyles: {
    us: { date: 'EEE, MMM d', time: 'h:mm a', label: 'Mon, Nov 2 · 9:30 AM' },
    eu: { date: 'EEE d MMM', time: 'HH:mm', label: 'Mon 2 Nov · 09:30' },
    numeric: { date: 'dd.MM.yyyy', time: 'HH:mm', label: '02.11.2026 · 09:30' },
    iso: { date: 'yyyy-MM-dd', time: 'HH:mm', label: '2026-11-02 · 09:30' },
  },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SMSTunnel')
    .addItem('Set up', 'smstunnelSetUp')
    .addItem('Send me a test reminder', 'smstunnelTestReminder')
    .addItem('Preview the next texts', 'smstunnelPreview')
    .addItem('Send due texts now', 'smstunnelSendDueNow')
    .addSeparator()
    .addItem('Turn texts off', 'smstunnelTurnOff')
    .addItem('Help', 'smstunnelHelp')
    .addToUi();
  try {
    var s = SmsTunnelKit.loadSettings();
    if (!s || s.enabled !== true) SpreadsheetApp.getActiveSpreadsheet().toast('Open the SMSTunnel menu → Set up to start.', 'SMSTunnel', 8);
  } catch (e) {
    // onOpen runs before you authorize the script; the hint can wait.
  }
}

function smstunnelSetUp() {
  SmsTunnelKit.requireScopes();
  SmsTunnelKit.showDialog(SMSTUNNEL_APP, 'Setup', 'SMSTunnel for Google Calendar', 540, 700);
}

/** For the setup dialog. */
function smstunnelGetSetupData() {
  var s = smstunnelSettingsWithDefaults_(SmsTunnelKit.loadSettings());
  var state = SmsTunnelKit.setupState();
  var calendars = CalendarApp.getAllCalendars().map(function (cal) {
    return { id: cal.getId(), name: cal.getName(), primary: cal.isMyPrimaryCalendar(), timeZone: cal.getTimeZone() };
  });
  calendars.sort(function (a, b) {
    return (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name);
  });
  var primary = calendars.filter(function (c) { return c.primary; })[0] || calendars[0];
  if (!s.me.calendars.length && primary) s.me.calendars = [primary.id];
  if (!s.clients.calendars.length && primary) s.clients.calendars = [primary.id];
  var styles = Object.keys(SMSTUNNEL_CALENDAR.dateStyles).map(function (id) {
    return { value: id, label: SMSTUNNEL_CALENDAR.dateStyles[id].label };
  });
  return {
    key: SmsTunnelKit.keyStatus(),
    setup: state,
    on: state === 'mine' && s.enabled === true && SmsTunnelKit.countTriggers(SMSTUNNEL_APP.handlers) > 0,
    interval: s.enabled ? smstunnelInterval_(s) : 0,
    calendars: calendars,
    leads: SMSTUNNEL_CALENDAR.leads,
    clientHours: SMSTUNNEL_CALENDAR.clientHours,
    placeholders: SMSTUNNEL_CALENDAR.placeholders,
    dateStyles: styles,
    phoneBookSheet: SMSTUNNEL_CALENDAR.phoneBookSheet,
    settings: {
      ownerNumbers: s.ownerNumbers.join('\n'),
      countryCode: s.countryCode,
      deviceId: s.deviceId,
      dateStyle: s.dateStyle,
      cap: s.cap,
      me: s.me,
      agenda: s.agenda,
      clients: s.clients,
    },
  };
}

function smstunnelCheckKey(key) {
  return SmsTunnelKit.checkKey(key);
}

function smstunnelForgetKey() {
  SmsTunnelKit.forgetKey();
  return SmsTunnelKit.keyStatus();
}

/** For the setup dialog: checks everything, saves it and turns the texts on. */
function smstunnelSaveSetup(input) {
  SmsTunnelKit.requireScopes();
  var checked = smstunnelReadInput_(input || {}, true);
  if (checked.errors) return { ok: false, errors: checked.errors };
  var s = checked.settings;
  SmsTunnelKit.saveKey((input || {}).apiKey);
  s.enabled = true;
  SmsTunnelKit.saveSettings(s);
  SmsTunnelKit.logSheet();
  if (s.clients.on && s.clients.fromGuests) SmsTunnelKit.ownSheet(SMSTUNNEL_CALENDAR.phoneBookSheet, SMSTUNNEL_CALENDAR.phoneBookHeaders, false);
  SmsTunnelKit.removeTriggers(SMSTUNNEL_APP.handlers);
  SmsTunnelKit.claimSetup();
  var interval = smstunnelInterval_(s);
  if (interval >= 60) ScriptApp.newTrigger('smstunnelCheckCalendar').timeBased().everyHours(1).create();
  else ScriptApp.newTrigger('smstunnelCheckCalendar').timeBased().everyMinutes(interval).create();
  SmsTunnelKit.clearProblem();

  var parts = [];
  if (s.me.on) parts.push('you get a text ' + smstunnelLeadWords_(s.me.lead) + ' before each event');
  if (s.agenda.on) parts.push('your agenda comes at ' + SmsTunnelKit.pad(s.agenda.hour) + ':' + SmsTunnelKit.pad(s.agenda.minute) + ' each day');
  if (s.clients.on) parts.push('the people in your events get a reminder up to ' + s.clients.hours + ' hours before');
  return {
    ok: true,
    interval: interval,
    message:
      'Texts are on: ' + parts.join('; ') + '. SMSTunnel checks your calendar every ' + (interval >= 60 ? 'hour' : interval + ' minutes') +
      '. SMSTunnel → Preview the next texts shows what will go out.',
  };
}

/** The dialog's "Send me a test reminder" button: uses what is in the dialog, saved or not. */
function smstunnelSendTestReminder(input) {
  var data = input || {};
  var checked = smstunnelReadInput_(data, false);
  var blocking = ['apiKey', 'ownerNumbers', 'countryCode', 'deviceId', 'meMessage', 'meLead'];
  if (checked.errors && blocking.some(function (field) { return checked.errors[field]; })) {
    return { ok: false, errors: checked.errors };
  }
  var s = checked.settings;
  if (!s.ownerNumbers.length) return { ok: false, errors: { ownerNumbers: 'Add your own number first: the test goes there.' } };
  if (String(data.apiKey || '').trim()) s.apiKey = String(data.apiKey).trim();
  return smstunnelTestReminderFor_(s, new Date());
}

/** The menu's "Send me a test reminder": uses the saved settings. */
function smstunnelTestReminder() {
  var s = SmsTunnelKit.loadSettings();
  if (!s || !s.ownerNumbers || !s.ownerNumbers.length || !SmsTunnel.hasApiKey()) {
    SmsTunnelKit.alert(SMSTUNNEL_APP, 'Set up first', 'Open SMSTunnel → Set up: paste your key and your own number. The dialog has the same test button.');
    return;
  }
  var result = smstunnelTestReminderFor_(smstunnelSettingsWithDefaults_(s), new Date());
  SmsTunnelKit.alert(SMSTUNNEL_APP, result.ok ? 'Test reminder sent' : 'No test reminder sent', result.message || '');
}

/** The time trigger. */
function smstunnelCheckCalendar(e) {
  var settings = SmsTunnelKit.beginRun(e, SMSTUNNEL_APP);
  if (!settings) return;
  var s = smstunnelSettingsWithDefaults_(settings);
  var outcome = SmsTunnelKit.withLock(function () {
    return smstunnelRun_(s, new Date(), {});
  }, 30000);
  if (outcome.busy) {
    console.warn(SMSTUNNEL_APP.name + ': another run held the spreadsheet; this check waits for the next one.');
    return;
  }
  if (outcome.sent || outcome.notSent || outcome.stopped || outcome.problem) console.log(SMSTUNNEL_APP.name + ': ' + smstunnelSummaryText_(outcome));
  if (outcome.problem) {
    var last = SmsTunnelKit.lastProblem();
    if (!last || last.text !== outcome.problem) SmsTunnelKit.log(SMSTUNNEL_APP, { result: 'Stopped', details: outcome.problem });
    SmsTunnelKit.noteProblem(outcome.problem);
    // Google emails you about a trigger run that fails, so a key that stopped working doesn't go unnoticed.
    throw new Error(SMSTUNNEL_APP.name + ': ' + outcome.problem);
  }
}

function smstunnelPreview() {
  var app = SMSTUNNEL_APP;
  var saved = SmsTunnelKit.loadSettings();
  if (!saved) {
    SmsTunnelKit.alert(app, 'Set up first', 'Open SMSTunnel → Set up.');
    return;
  }
  var s = smstunnelSettingsWithDefaults_(saved);
  var now = new Date();
  var outcome = smstunnelRun_(s, now, { dryRun: true, ignoreQuiet: true, lookAheadHours: 24 });
  var esc = SmsTunnelKit.escapeHtml;
  var tz = smstunnelZone_(s.me.calendars.concat(s.clients.calendars));
  var rows = outcome.plan
    .map(function (item) {
      var when = Utilities.formatDate(item.due, tz, 'EEE d MMM, HH:mm');
      var what = item.skip ? '<span class="bad">' + esc(item.skip) + '</span>' : '<div class="text">' + esc(item.text) + '</div>';
      return '<tr><td>' + esc(when) + '<div class="muted">' + esc(item.label) + '</div></td><td>' + esc(item.to || '') + '</td><td>' + what + '</td></tr>';
    })
    .join('');
  var agenda = s.agenda.on ? smstunnelAgendaFor_(s, now, true) : null;
  var html =
    '<p>The texts due in the next 24 hours that have not gone out yet. Nothing is sent from this window.</p>' +
    (rows ? '<table><tr><th>Goes out around</th><th>To</th><th>Text</th></tr>' + rows + '</table>' : '<p><b>Nothing is due in the next 24 hours.</b></p>') +
    (agenda ? '<h2>Your agenda for today (sent at ' + esc(SmsTunnelKit.pad(s.agenda.hour) + ':' + SmsTunnelKit.pad(s.agenda.minute)) + ')</h2><p class="text">' + esc(agenda.text || 'Nothing planned today, so no agenda text.') + '</p>' : '') +
    (outcome.notes.length ? '<p class="muted">' + esc(outcome.notes.join(' ')) + '</p>' : '') +
    '<p class="muted">Times in ' + esc(tz) + '. "Goes out around" depends on when the next check runs.</p>';
  SmsTunnelKit.showPage(app, 'SMSTunnel: next texts', html, 620, 500);
}

function smstunnelSendDueNow() {
  var app = SMSTUNNEL_APP;
  var saved = SmsTunnelKit.loadSettings();
  if (!saved || saved.enabled !== true || SmsTunnelKit.setupState() !== 'mine') {
    SmsTunnelKit.alert(app, 'Set up first', 'Open SMSTunnel → Set up. (If another editor set up the texts here, they can send them.)');
    return;
  }
  var outcome = SmsTunnelKit.withLock(function () {
    return smstunnelRun_(smstunnelSettingsWithDefaults_(saved), new Date(), {});
  }, 30000);
  if (outcome.busy) {
    SmsTunnelKit.alert(app, 'Busy', 'A check is running right now. Try again in a minute.');
    return;
  }
  if (outcome.problem) SmsTunnelKit.noteProblem(outcome.problem);
  SmsTunnelKit.alert(app, 'Done', smstunnelSummaryText_(outcome));
}

function smstunnelTurnOff() {
  SmsTunnelKit.turnOff(SMSTUNNEL_APP);
  SmsTunnelKit.alert(SMSTUNNEL_APP, 'Texts are off', 'No more calendar texts. Your settings and key are kept: Set up turns them on again.');
}

function smstunnelHelp() {
  var s = smstunnelSettingsWithDefaults_(SmsTunnelKit.loadSettings());
  var esc = SmsTunnelKit.escapeHtml;
  SmsTunnelKit.showHelp(
    SMSTUNNEL_APP,
    '<p>Google Calendar stopped sending text (SMS) notifications in January 2019. This brings them back, from your own phone:</p><ul>' +
      '<li><b>Remind me</b>: a text to your own numbers ' + esc(smstunnelLeadWords_(s.me.lead)) + ' before each event' + (s.me.keyword ? ' whose title has "' + esc(s.me.keyword) + '"' : '') + '.</li>' +
      '<li><b>My agenda</b>: one text a day with the day\'s events.</li>' +
      '<li><b>Reminders to people in your events</b>: the number on a line like "SMS: +1 415 555 0123" in the description, or a guest\'s number from the "' + esc(SMSTUNNEL_CALENDAR.phoneBookSheet) + '" sheet (Email, Phone, Name). Only events you created, unless you choose otherwise.</li></ul>' +
      '<p>Each text goes out once per event and number. If an event moves, its new time gets one new text. All-day events are left out unless you include them. Every text is listed in the "SMSTunnel log" sheet.</p>'
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────────────────────────────────────

function smstunnelSettingsWithDefaults_(saved) {
  var s = saved || {};
  var me = s.me || {};
  var agenda = s.agenda || {};
  var clients = s.clients || {};
  var c = SMSTUNNEL_CALENDAR;
  return {
    enabled: s.enabled === true,
    ownerNumbers: Array.isArray(s.ownerNumbers) ? s.ownerNumbers : [],
    countryCode: s.countryCode || '',
    deviceId: s.deviceId || '',
    apiKey: s.apiKey || '',
    dateStyle: c.dateStyles[s.dateStyle] ? s.dateStyle : 'us',
    cap: Number(s.cap) || c.defaultCap,
    me: {
      on: me.on === undefined ? true : me.on === true,
      calendars: Array.isArray(me.calendars) ? me.calendars : [],
      keyword: me.keyword || '',
      lead: Number(me.lead) || 15,
      allDay: me.allDay === true,
      allDayHour: me.allDayHour === undefined ? 8 : Number(me.allDayHour),
      message: me.message || c.meMessage,
    },
    agenda: {
      on: agenda.on === true,
      hour: agenda.hour === undefined ? 7 : Number(agenda.hour),
      minute: agenda.minute === undefined ? 0 : Number(agenda.minute),
      skipEmpty: agenda.skipEmpty === undefined ? true : agenda.skipEmpty === true,
    },
    clients: {
      on: clients.on === true,
      calendars: Array.isArray(clients.calendars) ? clients.calendars : [],
      hours: Number(clients.hours) || 24,
      labels: clients.labels === undefined ? c.labels : String(clients.labels),
      fromDescription: clients.fromDescription === undefined ? true : clients.fromDescription === true,
      fromGuests: clients.fromGuests === undefined ? true : clients.fromGuests === true,
      ownOnly: clients.ownOnly === undefined ? true : clients.ownOnly === true,
      quietFrom: clients.quietFrom === undefined ? 8 : Number(clients.quietFrom),
      quietTo: clients.quietTo === undefined ? 21 : Number(clients.quietTo),
      message: clients.message || c.clientMessage,
    },
  };
}

/** Checks what the dialog sent; full = true for saving (every part), false for the test button. */
function smstunnelReadInput_(data, full) {
  var c = SMSTUNNEL_CALENDAR;
  var errors = {};
  var me = data.me || {};
  var agenda = data.agenda || {};
  var clients = data.clients || {};
  var known = CalendarApp.getAllCalendars().map(function (cal) {
    return cal.getId();
  });

  var countryCode = '';
  if (String(data.countryCode || '').trim()) {
    countryCode = SmsTunnel.cleanCountryCode(String(data.countryCode)) || '';
    if (!countryCode) errors.countryCode = 'Write a country code like +1 or +40, or leave it empty.';
  }
  var owners = SmsTunnelKit.parseNumbers(data.ownerNumbers, countryCode, c.maxOwnerNumbers);
  if (owners.problem) errors.ownerNumbers = owners.problem;
  var deviceId = String(data.deviceId || '').trim();
  if (deviceId && !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) errors.deviceId = 'Choose a phone from the list.';
  var keyProblem = SmsTunnelKit.keyProblem(data.apiKey);
  if (keyProblem) errors.apiKey = keyProblem;

  function calendarsOf(list, field) {
    var ids = (Array.isArray(list) ? list : []).map(String).filter(function (id) {
      return known.indexOf(id) >= 0;
    });
    if (!ids.length) errors[field] = 'Choose at least one calendar.';
    return ids;
  }

  function templateOf(text, field) {
    var value = String(text || '').trim();
    if (!value) errors[field] = 'Write the text.';
    else if (SmsTunnel.textLength(value) > 1600) errors[field] = 'The text is too long (at most 1600 characters).';
    else {
      var unknown = SmsTunnelKit.unknownPlaceholders(value, c.placeholders);
      if (unknown.length) errors[field] = 'Unknown {' + unknown.join('}, {') + '}. You can use {' + c.placeholders.join('}, {') + '}.';
    }
    return value;
  }

  var s = {
    ownerNumbers: owners.numbers,
    countryCode: countryCode,
    deviceId: deviceId,
    dateStyle: c.dateStyles[data.dateStyle] ? String(data.dateStyle) : 'us',
    cap: Math.floor(Number(data.cap)),
    me: {
      on: me.on === true,
      calendars: calendarsOf(me.calendars, 'meCalendars'),
      keyword: String(me.keyword || '').trim().slice(0, 100),
      lead: Number(me.lead),
      allDay: me.allDay === true,
      allDayHour: Math.floor(Number(me.allDayHour)),
      message: templateOf(me.message, 'meMessage'),
    },
    agenda: {
      on: agenda.on === true,
      hour: Math.floor(Number(agenda.hour)),
      minute: Math.floor(Number(agenda.minute)),
      skipEmpty: agenda.skipEmpty !== false,
    },
    clients: {
      on: clients.on === true,
      calendars: clients.on === true ? calendarsOf(clients.calendars, 'clientCalendars') : (clients.calendars || []).map(String),
      hours: Number(clients.hours),
      labels: String(clients.labels || '').trim().slice(0, 200),
      fromDescription: clients.fromDescription === true,
      fromGuests: clients.fromGuests === true,
      ownOnly: clients.ownOnly !== false,
      quietFrom: Math.floor(Number(clients.quietFrom)),
      quietTo: Math.floor(Number(clients.quietTo)),
      message: clients.on === true ? templateOf(clients.message, 'clientMessage') : String(clients.message || c.clientMessage),
    },
  };

  if (c.leads.indexOf(s.me.lead) < 0) errors.meLead = 'Choose when to get the reminder.';
  if (!(s.me.allDayHour >= 0 && s.me.allDayHour <= 23)) s.me.allDayHour = 8;
  if (!(s.agenda.hour >= 0 && s.agenda.hour <= 23)) errors.agendaHour = 'Choose an hour.';
  if (c.agendaMinutes.indexOf(s.agenda.minute) < 0) s.agenda.minute = 0;

  if (full) {
    if (!s.me.on && !s.agenda.on && !s.clients.on) errors.parts = 'Turn on at least one kind of text.';
    if ((s.me.on || s.agenda.on) && !s.ownerNumbers.length && !errors.ownerNumbers) errors.ownerNumbers = 'Add your own number: your reminders and agenda go there.';
    if (!s.me.on) {
      // The calendars and text matter only when "Remind me" is on (the agenda uses the calendars too).
      if (!s.agenda.on) delete errors.meCalendars;
      delete errors.meMessage;
      delete errors.meLead;
    }
    if (!s.agenda.on) delete errors.agendaHour;
    if (s.clients.on) {
      if (c.clientHours.indexOf(s.clients.hours) < 0) errors.clientHours = 'Choose how long before.';
      if (!s.clients.fromDescription && !s.clients.fromGuests) errors.clientSources = 'Choose where the numbers come from.';
      if (s.clients.fromDescription && !smstunnelLabels_(s.clients.labels).length) errors.clientLabels = 'Write at least one word, like SMS.';
      if (!(s.clients.quietFrom >= 0 && s.clients.quietTo <= 24 && s.clients.quietFrom < s.clients.quietTo)) errors.clientQuiet = 'The first hour must come before the second.';
    }
    if (!(s.cap >= 1 && s.cap <= c.maxCap)) errors.cap = 'Choose a number from 1 to ' + c.maxCap + '.';
  } else {
    if (!(s.cap >= 1 && s.cap <= c.maxCap)) s.cap = c.defaultCap;
    delete errors.meCalendars;
    delete errors.clientCalendars;
    delete errors.clientMessage;
    delete errors.agendaHour;
  }
  if (!s.clients.on) {
    if (!(s.clients.quietFrom >= 0 && s.clients.quietTo <= 24 && s.clients.quietFrom < s.clients.quietTo)) {
      s.clients.quietFrom = 8;
      s.clients.quietTo = 21;
    }
    if (c.clientHours.indexOf(s.clients.hours) < 0) s.clients.hours = 24;
  }
  return Object.keys(errors).length ? { errors: errors, settings: s } : { settings: s };
}

/** How often to look at the calendar, in minutes: often enough for the shortest "remind me". */
function smstunnelInterval_(s) {
  if (s.me.on) return s.me.lead <= 15 ? 5 : s.me.lead <= 60 ? 10 : 15;
  if (s.agenda.on) return 15;
  return 60;
}

function smstunnelLeadWords_(minutes) {
  if (minutes < 60) return minutes + ' minutes';
  if (minutes < 1440) return minutes / 60 + (minutes === 60 ? ' hour' : ' hours');
  return minutes / 1440 + (minutes === 1440 ? ' day' : ' days');
}

function smstunnelLabels_(text) {
  return String(text || '')
    .split(/[,;\n]+/)
    .map(function (label) {
      return SmsTunnelKit.nameKey(label).replace(/\s+number$/, '');
    })
    .filter(Boolean);
}

// ─── The work ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Plans the texts that are due now (or, with lookAheadHours, within that many hours, for the preview), leaves out
 * the ones already sent, and sends them, soonest first, at most s.cap. With dryRun it only plans.
 */
function smstunnelRun_(s, now, options) {
  var opts = options || {};
  var outcome = { sent: 0, notSent: 0, waiting: 0, plan: [], notes: [], problem: '', stopped: '' };
  if (!opts.dryRun) smstunnelPruneDaily_(now);
  var store = SmsTunnelKit.sentStore();
  var plan = [];
  if (s.me.on) plan = plan.concat(smstunnelPlanMe_(s, now, opts, outcome));
  if (s.agenda.on && !opts.lookAheadHours) {
    var agenda = smstunnelAgendaFor_(s, now, false);
    if (agenda && agenda.text) {
      s.ownerNumbers.forEach(function (number) {
        plan.push({ key: 'agenda|' + agenda.day + '|' + number, start: agenda.at, due: now, label: 'Your agenda', to: number, text: agenda.text });
      });
    }
  }
  if (s.clients.on) plan = plan.concat(smstunnelPlanClients_(s, now, opts, outcome));
  plan = plan.filter(function (item) {
    return !store.has(item.key);
  });
  plan.sort(function (a, b) {
    return a.start.getTime() - b.start.getTime();
  });
  outcome.plan = plan;
  if (opts.dryRun) return outcome;

  var cap = Number(s.cap) || SMSTUNNEL_CALENDAR.defaultCap;
  for (var i = 0; i < plan.length; i++) {
    var item = plan[i];
    if (item.skip) {
      store.add(item.key, item.start);
      SmsTunnelKit.log(SMSTUNNEL_APP, { where: item.label, to: item.to, result: 'Not sent', details: item.skip });
      outcome.notSent++;
      continue;
    }
    if (outcome.sent >= cap) {
      outcome.waiting++;
      continue;
    }
    if (outcome.sent > 0) SmsTunnelKit.pause();
    var result = SmsTunnelKit.sendOne(item.to, item.text, s, item.key);
    if (result.ok) {
      store.add(item.key, item.start);
      SmsTunnelKit.log(SMSTUNNEL_APP, {
        where: item.label,
        to: item.to,
        result: result.queued ? 'Waiting for your phone' : 'Sent',
        details: result.already
          ? 'SMSTunnel already had a text for this from an earlier check.'
          : (result.queued ? 'Your phone was offline: the text goes out when it is back online. ' : '') + 'Message id ' + result.messageId,
      });
      outcome.sent++;
      continue;
    }
    if (result.kind === 'row') {
      store.add(item.key, item.start);
      SmsTunnelKit.log(SMSTUNNEL_APP, { where: item.label, to: item.to, result: 'Not sent', details: result.explain });
      outcome.notSent++;
      continue;
    }
    SmsTunnelKit.log(SMSTUNNEL_APP, { where: item.label, to: item.to, result: 'Stopped', details: result.explain });
    if (result.kind === 'transient') outcome.stopped = result.explain;
    else outcome.problem = result.explain;
    break;
  }
  if (outcome.waiting) {
    SmsTunnelKit.log(SMSTUNNEL_APP, { result: 'Waiting', details: outcome.waiting + ' more texts wait for the next check (at most ' + cap + ' per check).' });
  }
  return outcome;
}

/** Texts to you before your events. */
function smstunnelPlanMe_(s, now, opts, outcome) {
  var leadMs = s.me.lead * 60000;
  var horizon = now.getTime() + (opts.lookAheadHours ? opts.lookAheadHours * 3600000 + leadMs : leadMs);
  var plan = [];
  // getEvents returns the events that overlap [from, to); one more minute keeps an event that starts right at the lead time.
  smstunnelEvents_(s.me.calendars, now, new Date(horizon + 60000), outcome).forEach(function (found) {
    var event = found.event;
    if (smstunnelDeclined_(event)) return;
    if (!smstunnelMatchesKeyword_(event, s.me.keyword)) return;
    var start = smstunnelStart_(event, found.timeZone, s.me.allDay ? s.me.allDayHour : -1);
    if (!start || start.getTime() <= now.getTime()) return;
    var due = new Date(Math.max(now.getTime(), start.getTime() - leadMs));
    if (!opts.lookAheadHours && due.getTime() > now.getTime()) return;
    var values = smstunnelEventValues_(event, found, start, s, due);
    var text = SmsTunnelKit.truncate(SmsTunnelKit.fill(s.me.message, values).text.trim(), 1600);
    var eventKey = event.getId() + '|' + start.toISOString();
    s.ownerNumbers.forEach(function (number) {
      plan.push({ key: 'me|' + eventKey + '|' + number, start: start, due: due, label: smstunnelLabel_(event, start, found.timeZone, s), to: number, text: text });
    });
  });
  return plan;
}

/** Reminders to the people in your events. */
function smstunnelPlanClients_(s, now, opts, outcome) {
  var c = s.clients;
  var tz = smstunnelZone_(c.calendars);
  if (!opts.ignoreQuiet && SmsTunnelKit.isQuiet(now, tz, c.quietFrom, c.quietTo)) return [];
  var leadMs = c.hours * 3600000;
  var horizon = now.getTime() + leadMs + (opts.lookAheadHours ? opts.lookAheadHours * 3600000 : 0);
  var labels = smstunnelLabels_(c.labels);
  var book = c.fromGuests ? smstunnelPhoneBook_() : {};
  var plan = [];
  smstunnelEvents_(c.calendars, now, new Date(horizon + 60000), outcome).forEach(function (found) {
    var event = found.event;
    if (event.isAllDayEvent() || smstunnelDeclined_(event)) return;
    // An invitation from someone else could otherwise choose who gets a text from your phone.
    if (c.ownOnly && !smstunnelOwnedByMe_(event)) return;
    var start = event.getStartTime();
    if (start.getTime() <= now.getTime()) return;
    var due = new Date(Math.max(now.getTime(), start.getTime() - leadMs));
    if (!opts.lookAheadHours && due.getTime() > now.getTime()) return;
    var eventKey = event.getId() + '|' + start.toISOString();
    var label = smstunnelLabel_(event, start, found.timeZone, s);
    var people = [];
    var seen = {};
    function add(raw, display, name) {
      var phone = SmsTunnelKit.phoneFromCell(raw, display, s.countryCode);
      if (!phone.ok) {
        plan.push({ key: 'skip|' + eventKey + '|' + String(display || raw), start: start, due: due, label: label, to: String(display || raw), skip: phone.message });
        return;
      }
      if (seen[phone.number]) return;
      seen[phone.number] = true;
      people.push({ number: phone.number, name: name || '' });
    }
    try {
      if (c.fromDescription) {
        smstunnelNumbersInDescription_(event.getDescription(), labels).forEach(function (value) {
          add(value, value, '');
        });
      }
      if (c.fromGuests) {
        event.getGuestList().forEach(function (guest) {
          if (String(guest.getGuestStatus()) === String(CalendarApp.GuestStatus.NO)) return;
          var entry = book[String(guest.getEmail()).toLowerCase()];
          if (!entry) return;
          var guestName = guest.getName && guest.getName() !== guest.getEmail() ? guest.getName() : '';
          add(entry.raw, entry.display, entry.name || guestName);
        });
      }
    } catch (e) {
      outcome.notes.push('"' + SmsTunnelKit.truncate(event.getTitle() || '(no title)', 40) + '" could not be read (' + String((e && e.message) || e).slice(0, 80) + ').');
      return;
    }
    if (people.length > SMSTUNNEL_CALENDAR.perEvent) {
      plan.push({
        key: 'skip|' + eventKey + '|more',
        start: start,
        due: due,
        label: label,
        to: '',
        skip: people.length + ' people on one event: only the first ' + SMSTUNNEL_CALENDAR.perEvent + ' get a reminder.',
      });
      people = people.slice(0, SMSTUNNEL_CALENDAR.perEvent);
    }
    people.forEach(function (person) {
      var values = smstunnelEventValues_(event, found, start, s, due);
      values.name = person.name;
      var text = SmsTunnelKit.truncate(SmsTunnelKit.fill(c.message, values).text.trim(), 1600);
      plan.push({ key: 'client|' + eventKey + '|' + person.number, start: start, due: due, label: label, to: person.number, text: text });
    });
  });
  return plan;
}

/** Today's agenda: {day, at, text}, or null outside its window (unless always = true, for the preview). */
function smstunnelAgendaFor_(s, now, always) {
  var tz = smstunnelZone_(s.me.calendars);
  var day = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var at = SmsTunnelKit.dateAt(day, SmsTunnelKit.pad(s.agenda.hour) + ':' + SmsTunnelKit.pad(s.agenda.minute), tz);
  if (!always && (now.getTime() < at.getTime() || now.getTime() - at.getTime() > SMSTUNNEL_CALENDAR.agendaWindowHours * 3600000)) return null;
  var dayStart = SmsTunnelKit.dateAt(day, '00:00', tz);
  var next = Utilities.formatDate(new Date(dayStart.getTime() + 26 * 3600000), tz, 'yyyy-MM-dd');
  var dayEnd = SmsTunnelKit.dateAt(next, '00:00', tz);
  var style = SMSTUNNEL_CALENDAR.dateStyles[s.dateStyle] || SMSTUNNEL_CALENDAR.dateStyles.us;
  var allDay = [];
  var timed = [];
  smstunnelEvents_(s.me.calendars, dayStart, dayEnd, { notes: [] }).forEach(function (found) {
    var event = found.event;
    if (smstunnelDeclined_(event) || !smstunnelMatchesKeyword_(event, s.me.keyword)) return;
    var title = event.getTitle() || '(no title)';
    if (event.isAllDayEvent()) {
      if (s.me.allDay) allDay.push(title);
    }
    else if (event.getStartTime().getTime() >= dayStart.getTime()) timed.push({ start: event.getStartTime(), title: title });
  });
  timed.sort(function (a, b) {
    return a.start.getTime() - b.start.getTime();
  });
  var head = 'Today, ' + Utilities.formatDate(now, tz, style.date) + ':';
  if (!allDay.length && !timed.length) return { day: day, at: at, text: s.agenda.skipEmpty ? '' : head + ' nothing on your calendar.' };
  var lines = allDay
    .map(function (title) {
      return 'All day: ' + title;
    })
    .concat(
      timed.map(function (item) {
        return Utilities.formatDate(item.start, tz, style.time) + ' ' + item.title;
      })
    );
  var text = head;
  for (var i = 0; i < lines.length; i++) {
    var more = lines.length - i - 1;
    var candidate = text + '\n' + lines[i];
    var tail = more ? '\n+' + more + ' more' : '';
    if (SmsTunnel.textLength(candidate + tail) > 1600) {
      text += '\n+' + (lines.length - i) + ' more';
      break;
    }
    text = candidate;
  }
  return { day: day, at: at, text: text };
}

function smstunnelTestReminderFor_(s, now) {
  var found = null;
  var calendars = s.me.calendars.length ? s.me.calendars : [CalendarApp.getDefaultCalendar().getId()];
  var events = smstunnelEvents_(calendars, now, new Date(now.getTime() + 7 * 86400000), { notes: [] });
  events.sort(function (a, b) {
    return a.event.getStartTime().getTime() - b.event.getStartTime().getTime();
  });
  for (var i = 0; i < events.length && !found; i++) {
    var event = events[i].event;
    if (smstunnelDeclined_(event) || !smstunnelMatchesKeyword_(event, s.me.keyword)) continue;
    var start = smstunnelStart_(event, events[i].timeZone, s.me.allDay ? s.me.allDayHour : -1);
    if (start && start.getTime() > now.getTime()) found = { found: events[i], start: start };
  }
  var text;
  if (found) {
    text = SmsTunnelKit.fill(s.me.message, smstunnelEventValues_(found.found.event, found.found, found.start, s, now)).text.trim();
  } else {
    var sampleStart = new Date(now.getTime() + s.me.lead * 60000);
    var tz = smstunnelZone_(calendars);
    var style = SMSTUNNEL_CALENDAR.dateStyles[s.dateStyle] || SMSTUNNEL_CALENDAR.dateStyles.us;
    var values = {
      title: 'Dentist',
      date: Utilities.formatDate(sampleStart, tz, style.date),
      time: Utilities.formatDate(sampleStart, tz, style.time),
      location: 'Main Street 5',
      calendar: 'Calendar',
      'in': smstunnelIn_(sampleStart.getTime() - now.getTime()),
      name: 'Ana',
    };
    text = SmsTunnelKit.fill(s.me.message, values).text.trim();
  }
  text = SmsTunnelKit.truncate('Test: ' + text, 1600);
  var number = s.ownerNumbers[0];
  var result = SmsTunnelKit.sendOne(number, text, s);
  if (!result.ok) return { ok: false, message: result.explain };
  return {
    ok: true,
    message:
      (result.queued ? 'Your phone is offline: the test waits and goes out when it is back online. ' : 'Sent to ' + number + ': ') +
      '"' + text + '"' + (found ? '' : ' (no event in the next 7 days, so this one is made up).'),
  };
}

// ─── Calendar helpers ───────────────────────────────────────────────────────────────────────────────────────

/** Events overlapping [from, to) in the chosen calendars, each once, with its calendar's name and time zone. */
function smstunnelEvents_(calendarIds, from, to, outcome) {
  var out = [];
  var seen = {};
  (calendarIds || []).forEach(function (id) {
    var calendar = null;
    try {
      calendar = CalendarApp.getCalendarById(id);
    } catch (e) {
      calendar = null;
    }
    if (!calendar) {
      if (outcome && outcome.notes) outcome.notes.push('A calendar chosen in Set up is no longer available; open Set up to choose again.');
      return;
    }
    var timeZone = calendar.getTimeZone();
    calendar.getEvents(from, to).forEach(function (event) {
      var key = event.getId() + '|' + (event.isAllDayEvent() ? 'day ' + event.getAllDayStartDate().getTime() : event.getStartTime().getTime());
      if (seen[key]) return;
      seen[key] = true;
      out.push({ event: event, calendarName: calendar.getName(), timeZone: timeZone });
    });
  });
  return out;
}

/** When the event starts; an all-day event counts as starting at allDayHour that day (null when left out, -1). */
function smstunnelStart_(event, timeZone, allDayHour) {
  if (!event.isAllDayEvent()) return event.getStartTime();
  if (allDayHour < 0) return null;
  var day = Utilities.formatDate(event.getAllDayStartDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return SmsTunnelKit.dateAt(day, SmsTunnelKit.pad(allDayHour) + ':00', timeZone);
}

/** True for an event you created; false when it came as an invitation (or can't be told). */
function smstunnelOwnedByMe_(event) {
  try {
    return event.isOwnedByMe() === true;
  } catch (e) {
    return false;
  }
}

function smstunnelDeclined_(event) {
  try {
    return String(event.getMyStatus()) === String(CalendarApp.GuestStatus.NO);
  } catch (e) {
    return false;
  }
}

function smstunnelMatchesKeyword_(event, keyword) {
  var words = String(keyword || '')
    .split(',')
    .map(function (word) {
      return word.trim().toLowerCase();
    })
    .filter(Boolean);
  if (!words.length) return true;
  var title = String(event.getTitle() || '').toLowerCase();
  return words.some(function (word) {
    return title.indexOf(word) >= 0;
  });
}

function smstunnelZone_(calendarIds) {
  for (var i = 0; i < (calendarIds || []).length; i++) {
    try {
      var calendar = CalendarApp.getCalendarById(calendarIds[i]);
      if (calendar) return calendar.getTimeZone();
    } catch (e) {
      // try the next one
    }
  }
  return CalendarApp.getDefaultCalendar().getTimeZone();
}

function smstunnelEventValues_(event, found, start, s, from) {
  var style = SMSTUNNEL_CALENDAR.dateStyles[s.dateStyle] || SMSTUNNEL_CALENDAR.dateStyles.us;
  var tz = found.timeZone;
  return {
    title: event.getTitle() || '(no title)',
    date: Utilities.formatDate(start, tz, style.date),
    time: event.isAllDayEvent() ? 'all day' : Utilities.formatDate(start, tz, style.time),
    location: event.getLocation() || '',
    calendar: found.calendarName || '',
    'in': smstunnelIn_(start.getTime() - from.getTime()),
    name: '',
  };
}

/** "in 15 min", "in 1 h 30 min", "in 2 days". */
function smstunnelIn_(ms) {
  var minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return 'in ' + minutes + ' min';
  if (minutes < 1440) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return 'in ' + h + ' h' + (m ? ' ' + m + ' min' : '');
  }
  var days = Math.round(minutes / 1440);
  return 'in ' + days + (days === 1 ? ' day' : ' days');
}

function smstunnelLabel_(event, start, timeZone, s) {
  var style = SMSTUNNEL_CALENDAR.dateStyles[s.dateStyle] || SMSTUNNEL_CALENDAR.dateStyles.us;
  var when = event.isAllDayEvent() ? Utilities.formatDate(start, timeZone, style.date) : Utilities.formatDate(start, timeZone, style.date + ' ' + style.time);
  return SmsTunnelKit.truncate(event.getTitle() || '(no title)', 60) + ' · ' + when;
}

/**
 * The numbers on description lines that start with one of your words, like "SMS: +1 415 555 0123" or
 * "Phone number: 0722 123 456". Other numbers in the description (a dial-in line, an address) are left alone.
 */
function smstunnelNumbersInDescription_(description, labels) {
  if (!description || !labels.length) return [];
  var found = [];
  smstunnelHtmlToText_(description)
    .split(/\r?\n/)
    .forEach(function (line) {
      var m = /^\s*([^\d\s:\uFF1A+<>@/][^\d:\uFF1A+<>@/]{0,39}?)\s*[:\uFF1A]\s*(.+?)\s*$/.exec(line);
      if (!m) return;
      var label = SmsTunnelKit.nameKey(m[1]).replace(/\s+number$/, '');
      if (labels.indexOf(label) < 0) return;
      var number = /^\+?[\d\s.()\-]{7,25}/.exec(m[2]);
      var value = (number ? number[0] : m[2]).trim();
      if (value && found.indexOf(value) < 0) found.push(value);
    });
  return found;
}

function smstunnelHtmlToText_(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d{1,7});/g, function (match, code) {
      var n = Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, function (match, code) {
      var n = parseInt(code, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** Guests' numbers from the "Phone numbers" sheet: {email: {raw, display, name}}. */
function smstunnelPhoneBook_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SMSTUNNEL_CALENDAR.phoneBookSheet);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var headers = SmsTunnelKit.headersOf(sheet);
  function column(pattern) {
    for (var i = 0; i < headers.length; i++) if (pattern.test(headers[i])) return i;
    return -1;
  }
  var email = column(/^e-?mail/i);
  var phone = column(/phone|mobile|sms|number|tel/i);
  var name = column(/name/i);
  if (email < 0 || phone < 0) return {};
  var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length);
  var raw = range.getValues();
  var display = range.getDisplayValues();
  var book = {};
  for (var r = 0; r < raw.length; r++) {
    var address = String(display[r][email]).trim().toLowerCase();
    if (!address || String(display[r][phone]).trim() === '') continue;
    book[address] = { raw: raw[r][phone], display: display[r][phone], name: name >= 0 ? String(display[r][name]).trim() : '' };
  }
  return book;
}

function smstunnelPruneDaily_(now) {
  var props = PropertiesService.getUserProperties();
  var today = Utilities.formatDate(now, 'Etc/UTC', 'yyyy-MM-dd');
  if (props.getProperty('SMSTUNNEL_PRUNED') === today) return;
  SmsTunnelKit.pruneSent(new Date(now.getTime() - SMSTUNNEL_CALENDAR.keepSentDays * 86400000));
  props.setProperty('SMSTUNNEL_PRUNED', today);
}

function smstunnelSummaryText_(outcome) {
  var parts = [outcome.sent + (outcome.sent === 1 ? ' text sent' : ' texts sent')];
  if (outcome.notSent) parts.push(outcome.notSent + ' not sent (see the "SMSTunnel log" sheet)');
  if (outcome.waiting) parts.push(outcome.waiting + ' waiting for the next check');
  var text = parts.join(', ') + '.';
  if (outcome.stopped) text += ' Stopped early: ' + outcome.stopped;
  if (outcome.problem) text += ' Stopped: ' + outcome.problem;
  if (outcome.notes && outcome.notes.length) text += ' ' + outcome.notes[0];
  return text;
}
