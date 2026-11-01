/**
 * SMSTunnel for Google Sheets: appointment reminders · https://smstunnel.io
 *
 * Every hour (or once a day), the rows whose appointment is within the next hours you choose get a reminder text
 * at the number in the row, once: the "Reminder sent" column records it. Rows without a valid number are skipped
 * and marked. Every text goes out from your own Android phone, from your own number.
 *
 * Open the spreadsheet → SMSTunnel menu → Set up.
 *
 * MIT License · Copyright (c) 2026 NARBOWEB SRL
 */
var SMSTUNNEL_APP = {
  name: 'SMSTunnel for Google Sheets: appointment reminders',
  short: 'Reminders',
  host: 'sheets',
  handlers: ['smstunnelSendReminders'],
};

var SMSTUNNEL_REMINDERS = {
  sentColumn: 'Reminder sent',
  message: 'Hi {Name}, a reminder of your appointment on {Date} at {Time}. Reply to this text if you need to change it.',
  hoursBefore: 24,
  defaultCap: 25,
  maxCap: 100,
  quietFrom: 8,
  quietTo: 21,
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SMSTunnel')
    .addItem('Set up', 'smstunnelSetUp')
    .addItem('Send a test text', 'smstunnelSendTestText')
    .addItem('Preview the next reminders', 'smstunnelPreview')
    .addItem('Send due reminders now', 'smstunnelSendDueNow')
    .addSeparator()
    .addItem('Turn reminders off', 'smstunnelTurnOff')
    .addItem('Help', 'smstunnelHelp')
    .addToUi();
}

function smstunnelSetUp() {
  SmsTunnelKit.requireScopes();
  SmsTunnelKit.showDialog(SMSTUNNEL_APP, 'Setup', 'SMSTunnel: appointment reminders', 500, 680);
}

/** For the setup dialog. */
function smstunnelGetSetupData() {
  var s = SmsTunnelKit.loadSettings() || {};
  var state = SmsTunnelKit.setupState();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var active = ss.getActiveSheet();
  return {
    key: SmsTunnelKit.keyStatus(),
    setup: state,
    on: state === 'mine' && s.enabled === true && SmsTunnelKit.countTriggers(SMSTUNNEL_APP.handlers) > 0,
    configured: !!s.sheetId,
    sheets: SmsTunnelKit.dataSheets().map(SmsTunnelKit.describeSheet),
    sentColumn: SMSTUNNEL_REMINDERS.sentColumn,
    timeZone: ss.getSpreadsheetTimeZone(),
    settings: {
      sheetId: s.sheetId || (active ? String(active.getSheetId()) : ''),
      phoneColumn: s.phoneColumn || '',
      dateColumn: s.dateColumn || '',
      timeColumn: s.timeColumn || '',
      message: s.message || SMSTUNNEL_REMINDERS.message,
      hoursBefore: s.hoursBefore || SMSTUNNEL_REMINDERS.hoursBefore,
      frequency: s.frequency || 'hourly',
      dailyHour: s.dailyHour === undefined ? 9 : s.dailyHour,
      quietFrom: s.quietFrom === undefined ? SMSTUNNEL_REMINDERS.quietFrom : s.quietFrom,
      quietTo: s.quietTo === undefined ? SMSTUNNEL_REMINDERS.quietTo : s.quietTo,
      cap: s.cap || SMSTUNNEL_REMINDERS.defaultCap,
      countryCode: s.countryCode || '',
      deviceId: s.deviceId || '',
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

/** For the setup dialog: checks everything, saves it and turns the reminders on. */
function smstunnelSaveSetup(input) {
  SmsTunnelKit.requireScopes();
  var data = input || {};
  var errors = {};
  var sheet = SmsTunnelKit.sheetById(data.sheetId);
  var headers = sheet ? SmsTunnelKit.headersOf(sheet) : [];
  if (!sheet) errors.sheetId = 'Choose the sheet with the appointments.';

  var phoneColumn = String(data.phoneColumn || '').trim();
  var dateColumn = String(data.dateColumn || '').trim();
  var timeColumn = String(data.timeColumn || '').trim();
  if (sheet && !SmsTunnelKit.findColumn(headers, phoneColumn)) errors.phoneColumn = 'Choose the column with the phone numbers.';
  if (sheet && !SmsTunnelKit.findColumn(headers, dateColumn)) errors.dateColumn = 'Choose the column with the appointment date.';
  if (sheet && timeColumn && !SmsTunnelKit.findColumn(headers, timeColumn)) errors.timeColumn = 'That column is not in the sheet.';
  var chosen = [phoneColumn, dateColumn, timeColumn].filter(Boolean).map(SmsTunnelKit.nameKey);
  if (chosen.length !== chosen.filter(function (c, i) { return chosen.indexOf(c) === i; }).length) errors.timeColumn = 'Choose a different column for each.';
  if (chosen.indexOf(SmsTunnelKit.nameKey(SMSTUNNEL_REMINDERS.sentColumn)) >= 0) errors.phoneColumn = '"' + SMSTUNNEL_REMINDERS.sentColumn + '" is where SMSTunnel writes; choose another column.';

  var message = String(data.message || '').trim();
  if (!message) errors.message = 'Write the reminder text.';
  else if (SmsTunnel.textLength(message) > 1600) errors.message = 'The text is too long (at most 1600 characters).';
  else if (sheet) {
    var unknown = SmsTunnelKit.unknownPlaceholders(message, headers);
    if (unknown.length) errors.message = 'The sheet has no column called {' + unknown.join('}, {') + '}. Use the buttons below the box.';
  }

  var hoursBefore = Math.floor(Number(data.hoursBefore));
  if (!(hoursBefore >= 1 && hoursBefore <= 168)) errors.hoursBefore = 'Choose 1 to 168 hours.';
  var frequency = data.frequency === 'daily' ? 'daily' : 'hourly';
  var dailyHour = Math.floor(Number(data.dailyHour));
  var quietFrom = Math.floor(Number(data.quietFrom));
  var quietTo = Math.floor(Number(data.quietTo));
  if (!(quietFrom >= 0 && quietTo <= 24 && quietFrom < quietTo)) errors.quietFrom = 'The first hour must come before the second.';
  if (frequency === 'daily') {
    if (!(dailyHour >= 0 && dailyHour <= 23)) errors.dailyHour = 'Choose an hour.';
    else if (dailyHour < quietFrom || dailyHour >= quietTo) errors.dailyHour = 'Choose an hour between ' + quietFrom + ':00 and ' + quietTo + ':00, the hours when texts may go out.';
  }
  var cap = Math.floor(Number(data.cap));
  if (!(cap >= 1 && cap <= SMSTUNNEL_REMINDERS.maxCap)) errors.cap = 'Choose a number from 1 to ' + SMSTUNNEL_REMINDERS.maxCap + '.';

  var countryCode = '';
  if (String(data.countryCode || '').trim()) {
    countryCode = SmsTunnel.cleanCountryCode(String(data.countryCode)) || '';
    if (!countryCode) errors.countryCode = 'Write a country code like +1 or +40, or leave it empty.';
  }
  var deviceId = String(data.deviceId || '').trim();
  if (deviceId && !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) errors.deviceId = 'Choose a phone from the list.';
  var keyProblem = SmsTunnelKit.keyProblem(data.apiKey);
  if (keyProblem) errors.apiKey = keyProblem;

  if (Object.keys(errors).length) return { ok: false, errors: errors };

  SmsTunnelKit.saveKey(data.apiKey);
  var settings = {
    enabled: true,
    sheetId: String(sheet.getSheetId()),
    phoneColumn: phoneColumn,
    dateColumn: dateColumn,
    timeColumn: timeColumn,
    sentColumn: SMSTUNNEL_REMINDERS.sentColumn,
    message: message,
    hoursBefore: hoursBefore,
    frequency: frequency,
    dailyHour: dailyHour >= 0 && dailyHour <= 23 ? dailyHour : 9,
    quietFrom: quietFrom,
    quietTo: quietTo,
    cap: cap,
    countryCode: countryCode,
    deviceId: deviceId,
  };
  SmsTunnelKit.ensureColumn(sheet, settings.sentColumn);
  SmsTunnelKit.saveSettings(settings);
  SmsTunnelKit.removeTriggers(SMSTUNNEL_APP.handlers);
  SmsTunnelKit.claimSetup();
  var timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  if (frequency === 'daily') {
    ScriptApp.newTrigger('smstunnelSendReminders').timeBased().everyDays(1).atHour(settings.dailyHour).inTimezone(timeZone).create();
  } else {
    ScriptApp.newTrigger('smstunnelSendReminders').timeBased().everyHours(1).create();
  }
  SmsTunnelKit.clearProblem();
  SmsTunnelKit.logSheet();
  return {
    ok: true,
    message:
      'Reminders are on. ' + (frequency === 'daily' ? 'Once a day, around ' + settings.dailyHour + ':00' : 'Every hour') +
      ', rows whose appointment is in the next ' + hoursBefore + ' hours get a text, once, between ' + quietFrom + ':00 and ' + quietTo + ':00 (' + timeZone + '). ' +
      'Use SMSTunnel → Preview the next reminders to see what will go out.',
  };
}

/** The time trigger. */
function smstunnelSendReminders(e) {
  var settings = SmsTunnelKit.beginRun(e, SMSTUNNEL_APP);
  if (!settings) return;
  var outcome = SmsTunnelKit.withLock(function () {
    return smstunnelRunReminders_(settings, new Date(), {});
  }, 30000);
  if (outcome.busy) {
    console.warn(SMSTUNNEL_APP.name + ': another run held the spreadsheet; the reminders wait for the next run.');
    return;
  }
  console.log(SMSTUNNEL_APP.name + ': ' + smstunnelSummaryText_(outcome));
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
  var settings = SmsTunnelKit.loadSettings();
  if (!settings || !settings.sheetId) {
    SmsTunnelKit.alert(app, 'Set up first', 'Open SMSTunnel → Set up.');
    return;
  }
  var now = new Date();
  var outcome = smstunnelRunReminders_(settings, now, { dryRun: true, ignoreQuiet: true });
  var esc = SmsTunnelKit.escapeHtml;
  var timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  if (outcome.problem) {
    SmsTunnelKit.alert(app, 'Check Set up', outcome.problem);
    return;
  }
  var rows = outcome.plan
    .map(function (item, i) {
      var when = Utilities.formatDate(item.start, timeZone, 'EEE d MMM, HH:mm');
      var what = item.skip ? '<span class="bad">Not sent: ' + esc(item.skip) + '</span>' : '<div class="text">' + esc(item.text) + '</div>';
      var later = !item.skip && i >= settings.cap ? '<div class="muted">After this run\'s ' + esc(settings.cap) + ' texts: goes out on the next run.</div>' : '';
      return '<tr><td>Row ' + item.row + '<div class="muted">' + esc(when) + '</div></td><td>' + esc(item.to || item.cell || '') + '</td><td>' + what + later + '</td></tr>';
    })
    .join('');
  var html =
    '<p>Appointments in the next ' + esc(settings.hoursBefore) + ' hours with no reminder yet (' + esc(timeZone) + '). Nothing is sent from this window.</p>' +
    (SmsTunnelKit.isQuiet(now, timeZone, settings.quietFrom, settings.quietTo)
      ? '<p class="muted">Right now is outside ' + esc(settings.quietFrom) + ':00–' + esc(settings.quietTo) + ':00, so the next run waits until ' + esc(settings.quietFrom) + ':00.</p>'
      : '') +
    (rows ? '<table><tr><th>Row</th><th>To</th><th>Text</th></tr>' + rows + '</table>' : '<p><b>No reminder is due.</b></p>') +
    (outcome.unreadable.length
      ? '<p class="muted">Rows with a date SMSTunnel can\'t read (use a real date, or yyyy-mm-dd): ' + esc(outcome.unreadable.slice(0, 20).join(', ')) + (outcome.unreadable.length > 20 ? '…' : '') + '</p>'
      : '');
  SmsTunnelKit.showPage(app, 'SMSTunnel: next reminders', html, 600, 480);
}

function smstunnelSendDueNow() {
  var app = SMSTUNNEL_APP;
  var settings = SmsTunnelKit.loadSettings();
  if (!settings || settings.enabled !== true || SmsTunnelKit.setupState() !== 'mine') {
    SmsTunnelKit.alert(app, 'Set up first', 'Open SMSTunnel → Set up. (If another editor set up the reminders here, they can send them.)');
    return;
  }
  var timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var now = new Date();
  var ignoreQuiet = false;
  if (SmsTunnelKit.isQuiet(now, timeZone, settings.quietFrom, settings.quietTo)) {
    if (!SmsTunnelKit.confirm(app, 'Outside your hours', 'It is ' + Utilities.formatDate(now, timeZone, 'HH:mm') + ' in ' + timeZone + ', outside ' + settings.quietFrom + ':00–' + settings.quietTo + ':00. Send the due reminders anyway?')) return;
    ignoreQuiet = true;
  }
  var outcome = SmsTunnelKit.withLock(function () {
    return smstunnelRunReminders_(settings, now, { ignoreQuiet: ignoreQuiet });
  }, 30000);
  if (outcome.busy) {
    SmsTunnelKit.alert(app, 'Busy', 'Another run is sending reminders right now. Try again in a minute.');
    return;
  }
  if (outcome.problem) SmsTunnelKit.noteProblem(outcome.problem);
  SmsTunnelKit.alert(app, 'Done', smstunnelSummaryText_(outcome));
}

function smstunnelSendTestText() {
  SmsTunnelKit.sendTestText(SMSTUNNEL_APP, '');
}

function smstunnelTurnOff() {
  SmsTunnelKit.turnOff(SMSTUNNEL_APP);
  SmsTunnelKit.alert(SMSTUNNEL_APP, 'Reminders are off', 'No more reminder texts. Your settings and key are kept: Set up turns the reminders on again.');
}

function smstunnelHelp() {
  var s = SmsTunnelKit.loadSettings() || {};
  var esc = SmsTunnelKit.escapeHtml;
  SmsTunnelKit.showHelp(
    SMSTUNNEL_APP,
    '<p>' + (s.frequency === 'daily' ? 'Once a day' : 'Every hour') + ', each row whose appointment is in the next ' + esc(s.hoursBefore || SMSTUNNEL_REMINDERS.hoursBefore) +
      ' hours gets one reminder at its number. "Reminder sent" shows when; a note on the cell shows the number and the message id.</p>' +
      '<ul><li>Texts go out only between ' + esc(s.quietFrom === undefined ? 8 : s.quietFrom) + ':00 and ' + esc(s.quietTo === undefined ? 21 : s.quietTo) + ':00 in the spreadsheet\'s time zone (File → Settings).</li>' +
      '<li>At most ' + esc(s.cap || SMSTUNNEL_REMINDERS.defaultCap) + ' reminders per run, soonest first; the rest go out on the next run.</li>' +
      '<li>Rows without a valid number are marked "Not sent" with the reason. To send a reminder again, clear its "Reminder sent" cell.</li>' +
      '<li>Preview the next reminders shows what would go out, without sending anything.</li></ul>'
  );
}

// ─── The work ───────────────────────────────────────────────────────────────────────────────────────────────

function smstunnelReminderLayout_(sheet, settings) {
  var headers = SmsTunnelKit.headersOf(sheet);
  var phone = SmsTunnelKit.findColumn(headers, settings.phoneColumn);
  var date = SmsTunnelKit.findColumn(headers, settings.dateColumn);
  var time = settings.timeColumn ? SmsTunnelKit.findColumn(headers, settings.timeColumn) : 0;
  var sent = SmsTunnelKit.findColumn(headers, settings.sentColumn);
  var missing = [];
  if (!phone) missing.push(settings.phoneColumn);
  if (!date) missing.push(settings.dateColumn);
  if (settings.timeColumn && !time) missing.push(settings.timeColumn);
  if (!sent) missing.push(settings.sentColumn);
  if (missing.length) {
    return {
      ok: false,
      problem: 'The sheet "' + sheet.getName() + '" has no column called "' + missing.join('", "') + '" any more. Open SMSTunnel → Set up and choose the columns again.',
    };
  }
  return { ok: true, sheet: sheet, headers: headers, phone: phone, date: date, time: time, sent: sent, width: Math.max(headers.length, phone, date, time, sent) };
}

/**
 * Finds the rows due for a reminder (appointment after now and within hoursBefore, no "Reminder sent" yet) and
 * texts them, soonest first, at most settings.cap. With dryRun it only returns the plan.
 */
function smstunnelRunReminders_(settings, now, options) {
  var opts = options || {};
  var outcome = { sent: 0, notSent: 0, waiting: 0, plan: [], unreadable: [], quiet: false, problem: '', stopped: '' };
  var sheet = SmsTunnelKit.sheetById(settings.sheetId);
  if (!sheet) {
    outcome.problem = 'The sheet chosen in Set up is gone. Open SMSTunnel → Set up.';
    return outcome;
  }
  var layout = smstunnelReminderLayout_(sheet, settings);
  if (!layout.ok) {
    outcome.problem = layout.problem;
    return outcome;
  }
  var timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  if (!opts.ignoreQuiet && SmsTunnelKit.isQuiet(now, timeZone, settings.quietFrom, settings.quietTo)) {
    outcome.quiet = true;
    return outcome;
  }
  var last = sheet.getLastRow();
  if (last < 2) return outcome;
  var range = sheet.getRange(2, 1, last - 1, layout.width);
  var raw = range.getValues();
  var display = range.getDisplayValues();
  var horizon = now.getTime() + Number(settings.hoursBefore) * 3600000;
  var due = [];
  for (var i = 0; i < raw.length; i++) {
    if (!smstunnelPending_(display[i][layout.sent - 1])) continue;
    var dateValue = raw[i][layout.date - 1];
    if (dateValue === '' || dateValue === null) continue;
    var start = smstunnelStartOf_(dateValue, layout.time ? raw[i][layout.time - 1] : '', timeZone);
    if (!start) {
      outcome.unreadable.push(i + 2);
      continue;
    }
    if (start.getTime() <= now.getTime() || start.getTime() > horizon) continue;
    due.push({ index: i, row: i + 2, start: start });
  }
  due.sort(function (a, b) {
    return a.start.getTime() - b.start.getTime() || a.row - b.row;
  });
  due.forEach(function (item) {
    var cell = display[item.index][layout.phone - 1];
    var phone = SmsTunnelKit.phoneFromCell(raw[item.index][layout.phone - 1], cell, settings.countryCode);
    if (!phone.ok) {
      outcome.plan.push({ row: item.row, start: item.start, cell: String(cell), skip: phone.message });
      return;
    }
    var filled = SmsTunnelKit.fill(settings.message, SmsTunnelKit.valuesFrom(layout.headers, display[item.index]));
    var text = filled.text.trim();
    var skip = '';
    if (filled.missing.length) skip = 'the text uses {' + filled.missing.join('}, {') + '}, but the sheet has no such column.';
    else if (!text) skip = 'the text is empty for this row.';
    else if (SmsTunnel.textLength(text) > 1600) skip = 'the text is ' + SmsTunnel.textLength(text) + ' characters long (at most 1600).';
    outcome.plan.push(skip ? { row: item.row, start: item.start, to: phone.number, skip: skip } : { row: item.row, start: item.start, to: phone.number, text: text });
  });
  if (opts.dryRun) return outcome;

  var cap = Number(settings.cap) || SMSTUNNEL_REMINDERS.defaultCap;
  for (var j = 0; j < outcome.plan.length; j++) {
    var plan = outcome.plan[j];
    if (plan.skip) {
      smstunnelMarkRow_(layout, plan.row, 'Not sent: ' + plan.skip, 'Fix the row and clear this cell to send the reminder.');
      SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + plan.row, to: plan.to || plan.cell, result: 'Not sent', details: plan.skip });
      outcome.notSent++;
      continue;
    }
    if (outcome.sent >= cap) {
      outcome.waiting++;
      continue;
    }
    if (outcome.sent > 0) SmsTunnelKit.pause();
    var once = smstunnelStartSending_(layout, plan.row);
    var result = SmsTunnelKit.sendOne(plan.to, plan.text, settings, once);
    if (result.ok) {
      var how = result.already ? 'SMSTunnel already had this reminder from an earlier try' : 'Message id: ' + result.messageId;
      smstunnelMarkRow_(layout, plan.row, new Date(), 'Reminder sent to ' + plan.to + (result.queued ? ' (your phone was offline: it goes out when the phone is back online)' : '') + '\n' + how);
      SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + plan.row, to: plan.to, result: result.queued ? 'Waiting for your phone' : 'Sent', details: how });
      outcome.sent++;
      continue;
    }
    if (result.kind === 'row') {
      smstunnelMarkRow_(layout, plan.row, 'Not sent: ' + result.explain, 'Fix the row and clear this cell to send the reminder.');
      SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + plan.row, to: plan.to, result: 'Not sent', details: result.explain });
      outcome.notSent++;
      continue;
    }
    SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + plan.row, to: plan.to, result: 'Stopped', details: result.explain });
    if (result.kind === 'transient') outcome.stopped = result.explain;
    else outcome.problem = result.explain;
    break;
  }
  if (outcome.waiting) {
    SmsTunnelKit.log(SMSTUNNEL_APP, { result: 'Waiting', details: outcome.waiting + ' more reminders wait for the next run (at most ' + cap + ' per run).' });
  }
  return outcome;
}

/** A row still to remind: "Reminder sent" is empty, or says "Sending…" (a try that may not have gone through). */
function smstunnelPending_(cell) {
  var value = String(cell === undefined || cell === null ? '' : cell).trim();
  return value === '' || value === SmsTunnelKit.SENDING;
}

/** "Sending…" with this try's key in the note, before the text goes out; a retry reuses the key. */
function smstunnelStartSending_(layout, row) {
  var cell = layout.sheet.getRange(row, layout.sent);
  var key = cell.getValue() === SmsTunnelKit.SENDING ? SmsTunnelKit.keyInNote(cell.getNote()) : '';
  if (!key) key = Utilities.getUuid();
  smstunnelMarkRow_(layout, row, SmsTunnelKit.SENDING, 'SMSTunnel key: ' + key + '\nIf this stays here, the next run tries again with the same key.');
  return key;
}

function smstunnelMarkRow_(layout, row, value, note) {
  var cell = layout.sheet.getRange(row, layout.sent);
  cell.setValue(value);
  if (typeof value !== 'string') cell.setNumberFormat('yyyy-mm-dd hh:mm');
  cell.setNote(note || '');
  SpreadsheetApp.flush();
}

/** The appointment's moment, from a date cell (with its own time, or a separate time cell), in the sheet's time zone. */
function smstunnelStartOf_(dateValue, timeValue, timeZone) {
  var pad = SmsTunnelKit.pad;
  var day;
  var time;
  if (SmsTunnelKit.isDate(dateValue)) {
    day = Utilities.formatDate(dateValue, timeZone, 'yyyy-MM-dd');
    time = Utilities.formatDate(dateValue, timeZone, 'HH:mm');
  } else if (typeof dateValue === 'string') {
    var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(dateValue);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return null;
    day = m[1] + '-' + pad(Number(m[2])) + '-' + pad(Number(m[3]));
    time = m[4] ? pad(Number(m[4])) + ':' + m[5] : '00:00';
  } else {
    return null;
  }
  if (timeValue !== '' && timeValue !== null && timeValue !== undefined) {
    if (SmsTunnelKit.isDate(timeValue)) time = Utilities.formatDate(timeValue, timeZone, 'HH:mm');
    else {
      var parsed = smstunnelTimeText_(String(timeValue));
      if (!parsed) return null;
      time = parsed;
    }
  }
  return SmsTunnelKit.dateAt(day, time, timeZone);
}

/** "14:30", "9:30", "2:30 PM", "9am", "14h30" → "HH:mm"; '' for anything else. */
function smstunnelTimeText_(text) {
  var m = /^\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?\s*$/i.exec(text);
  if (!m) return '';
  var hour = Number(m[1]);
  var minute = m[2] ? Number(m[2]) : 0;
  var half = m[3] ? m[3].charAt(0).toLowerCase() : '';
  if (!m[2] && !half) return '';
  if (minute > 59) return '';
  if (half) {
    if (hour < 1 || hour > 12) return '';
    hour = (hour % 12) + (half === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return '';
  }
  return SmsTunnelKit.pad(hour) + ':' + SmsTunnelKit.pad(minute);
}

function smstunnelSummaryText_(outcome) {
  if (outcome.quiet) return 'Outside the hours you chose, so nothing was sent; the next run inside them sends what is due.';
  var parts = [outcome.sent + (outcome.sent === 1 ? ' reminder sent' : ' reminders sent')];
  if (outcome.notSent) parts.push(outcome.notSent + ' not sent (see the "SMSTunnel log" sheet)');
  if (outcome.waiting) parts.push(outcome.waiting + ' waiting for the next run');
  var text = parts.join(', ') + '.';
  if (outcome.stopped) text += ' Stopped early: ' + outcome.stopped;
  if (outcome.problem) text += ' Stopped: ' + outcome.problem;
  return text;
}
