/**
 * SMSTunnel for Google Sheets: status texts · https://smstunnel.io
 *
 * When a row's status becomes the value you choose (like "Shipped" or "Ready"), the phone number in that row gets
 * a text you write, with the row's columns as {placeholders}. The "Texted at" column records it, so a row is
 * never texted twice. Every text goes out from your own Android phone, from your own number.
 *
 * Open the spreadsheet → SMSTunnel menu → Set up.
 *
 * MIT License · Copyright (c) 2026 NARBOWEB SRL
 */
var SMSTUNNEL_APP = {
  name: 'SMSTunnel for Google Sheets: status texts',
  short: 'Status texts',
  host: 'sheets',
  handlers: ['smstunnelOnEdit', 'smstunnelCheckWaitingRows'],
};

var SMSTUNNEL_STATUS = {
  textedColumn: 'Texted at',
  message: 'Hi {Name}, your order {Order} is {Status}.',
  defaultCap: 20,
  maxCap: 50,
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SMSTunnel')
    .addItem('Set up', 'smstunnelSetUp')
    .addItem('Send a test text', 'smstunnelSendTestText')
    .addItem('Send waiting texts now', 'smstunnelSendWaitingNow')
    .addSeparator()
    .addItem('Turn texts off', 'smstunnelTurnOff')
    .addItem('Help', 'smstunnelHelp')
    .addToUi();
}

function smstunnelSetUp() {
  SmsTunnelKit.requireScopes();
  SmsTunnelKit.showDialog(SMSTUNNEL_APP, 'Setup', 'SMSTunnel: text when a row changes', 500, 680);
}

/** For the setup dialog. */
function smstunnelGetSetupData() {
  var s = SmsTunnelKit.loadSettings() || {};
  var state = SmsTunnelKit.setupState();
  var active = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  return {
    key: SmsTunnelKit.keyStatus(),
    setup: state,
    on: state === 'mine' && s.enabled === true && SmsTunnelKit.countTriggers(SMSTUNNEL_APP.handlers) > 0,
    configured: !!s.sheetId,
    sheets: SmsTunnelKit.dataSheets().map(SmsTunnelKit.describeSheet),
    textedColumn: SMSTUNNEL_STATUS.textedColumn,
    settings: {
      sheetId: s.sheetId || (active ? String(active.getSheetId()) : ''),
      statusColumn: s.statusColumn || '',
      statusValue: s.statusValue || '',
      phoneColumn: s.phoneColumn || '',
      message: s.message || SMSTUNNEL_STATUS.message,
      countryCode: s.countryCode || '',
      deviceId: s.deviceId || '',
      sweep: s.sweep === true,
      cap: s.cap || SMSTUNNEL_STATUS.defaultCap,
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
  var data = input || {};
  var errors = {};
  var sheet = SmsTunnelKit.sheetById(data.sheetId);
  var headers = sheet ? SmsTunnelKit.headersOf(sheet) : [];
  if (!sheet) errors.sheetId = 'Choose the sheet with your rows.';

  var statusColumn = String(data.statusColumn || '').trim();
  var phoneColumn = String(data.phoneColumn || '').trim();
  if (sheet && !SmsTunnelKit.findColumn(headers, statusColumn)) errors.statusColumn = 'Choose the column that holds the status.';
  if (sheet && !SmsTunnelKit.findColumn(headers, phoneColumn)) errors.phoneColumn = 'Choose the column with the phone numbers.';
  if (statusColumn && SmsTunnelKit.nameKey(statusColumn) === SmsTunnelKit.nameKey(phoneColumn)) errors.phoneColumn = 'Choose a different column than the status.';
  [statusColumn, phoneColumn].forEach(function (name, i) {
    if (name && SmsTunnelKit.nameKey(name) === SmsTunnelKit.nameKey(SMSTUNNEL_STATUS.textedColumn)) {
      errors[i === 0 ? 'statusColumn' : 'phoneColumn'] = '"' + SMSTUNNEL_STATUS.textedColumn + '" is where SMSTunnel writes; choose another column.';
    }
  });

  var statusValue = String(data.statusValue || '').trim();
  if (!statusValue) errors.statusValue = 'Write the status that sends the text, like Shipped.';
  else if (statusValue.length > 100) errors.statusValue = 'Keep the status under 100 characters.';

  var message = String(data.message || '').trim();
  if (!message) errors.message = 'Write the text.';
  else if (SmsTunnel.textLength(message) > 1600) errors.message = 'The text is too long (at most 1600 characters).';
  else if (sheet) {
    var unknown = SmsTunnelKit.unknownPlaceholders(message, headers);
    if (unknown.length) errors.message = 'The sheet has no column called {' + unknown.join('}, {') + '}. Use the buttons below the box.';
  }

  var countryCode = '';
  if (String(data.countryCode || '').trim()) {
    countryCode = SmsTunnel.cleanCountryCode(String(data.countryCode)) || '';
    if (!countryCode) errors.countryCode = 'Write a country code like +1 or +40, or leave it empty.';
  }
  var cap = Math.floor(Number(data.cap));
  if (!(cap >= 1 && cap <= SMSTUNNEL_STATUS.maxCap)) errors.cap = 'Choose a number from 1 to ' + SMSTUNNEL_STATUS.maxCap + '.';
  var deviceId = String(data.deviceId || '').trim();
  if (deviceId && !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) errors.deviceId = 'Choose a phone from the list.';
  var keyProblem = SmsTunnelKit.keyProblem(data.apiKey);
  if (keyProblem) errors.apiKey = keyProblem;

  if (Object.keys(errors).length) return { ok: false, errors: errors };

  SmsTunnelKit.saveKey(data.apiKey);
  var settings = {
    enabled: true,
    sheetId: String(sheet.getSheetId()),
    statusColumn: statusColumn,
    statusValue: statusValue,
    phoneColumn: phoneColumn,
    textedColumn: SMSTUNNEL_STATUS.textedColumn,
    message: message,
    countryCode: countryCode,
    deviceId: deviceId,
    sweep: data.sweep === true,
    cap: cap,
  };
  SmsTunnelKit.ensureColumn(sheet, settings.textedColumn);
  var layout = smstunnelLayout_(sheet, settings);
  if (!layout.ok) return { ok: false, errors: { sheetId: layout.problem } };
  var stamped = SmsTunnelKit.withLock(function () {
    return smstunnelStampExisting_(sheet, layout, settings);
  }, 30000);
  // The rows that already have the value must be marked before any trigger exists, or the first check would text them.
  if (typeof stamped !== 'number') return { ok: false, errors: { busy: 'SMSTunnel is texting rows of this spreadsheet right now. Click Save again in a minute.' } };
  SmsTunnelKit.saveSettings(settings);
  SmsTunnelKit.removeTriggers(SMSTUNNEL_APP.handlers);
  SmsTunnelKit.claimSetup();
  ScriptApp.newTrigger('smstunnelOnEdit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  if (settings.sweep) ScriptApp.newTrigger('smstunnelCheckWaitingRows').timeBased().everyMinutes(15).create();
  SmsTunnelKit.clearProblem();
  SmsTunnelKit.logSheet();

  var count = stamped;
  return {
    ok: true,
    message:
      'Texts are on. When ' + statusColumn + ' becomes "' + statusValue + '", the number in that row gets your text, and "' +
      settings.textedColumn + '" shows when.' +
      (count ? ' ' + count + (count === 1 ? ' row was' : ' rows were') + ' already "' + statusValue + '": they are marked as skipped, so only changes from now on send a text.' : ''),
  };
}

/** The edit trigger: runs when someone edits the spreadsheet. */
function smstunnelOnEdit(e) {
  var settings = SmsTunnelKit.beginRun(e, SMSTUNNEL_APP);
  if (!settings || !e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  if (String(sheet.getSheetId()) !== String(settings.sheetId)) return;
  var layout = smstunnelLayout_(sheet, settings);
  if (!layout.ok) {
    smstunnelReportLayout_(layout);
    return;
  }
  if (range.getColumn() > layout.status || range.getLastColumn() < layout.status) return;
  var first = Math.max(2, range.getRow());
  var last = Math.min(range.getLastRow(), sheet.getLastRow());
  if (last < first) return;
  var summary = SmsTunnelKit.withLock(function () {
    return smstunnelProcessRows_(sheet, layout, settings, first, last);
  }, 30000);
  smstunnelFinish_(summary);
}

/** The optional 15-minute trigger: texts rows changed by other apps (an edit by a script or an app doesn't run the edit trigger). */
function smstunnelCheckWaitingRows(e) {
  var settings = SmsTunnelKit.beginRun(e, SMSTUNNEL_APP);
  if (!settings) return;
  var sheet = SmsTunnelKit.sheetById(settings.sheetId);
  if (!sheet) return;
  var layout = smstunnelLayout_(sheet, settings);
  if (!layout.ok) {
    smstunnelReportLayout_(layout);
    return;
  }
  var summary = SmsTunnelKit.withLock(function () {
    return smstunnelProcessRows_(sheet, layout, settings, 2, sheet.getLastRow());
  }, 30000);
  smstunnelFinish_(summary);
}

function smstunnelSendWaitingNow() {
  var app = SMSTUNNEL_APP;
  var settings = SmsTunnelKit.loadSettings();
  if (!settings || settings.enabled !== true || SmsTunnelKit.setupState() !== 'mine') {
    SmsTunnelKit.alert(app, 'Set up first', 'Open SMSTunnel → Set up. (If another editor set up the texts here, they can send them.)');
    return;
  }
  var sheet = SmsTunnelKit.sheetById(settings.sheetId);
  var layout = sheet ? smstunnelLayout_(sheet, settings) : { ok: false, problem: 'The sheet chosen in Set up is gone.' };
  if (!layout.ok) {
    SmsTunnelKit.alert(app, 'Check Set up', layout.problem);
    return;
  }
  var rows = smstunnelWaitingRows_(sheet, layout, settings);
  if (!rows.length) {
    SmsTunnelKit.alert(app, 'Nothing waiting', 'No row has ' + settings.statusColumn + ' "' + settings.statusValue + '" and an empty "' + settings.textedColumn + '".');
    return;
  }
  var shown = rows.slice(0, 8).join(', ') + (rows.length > 8 ? '…' : '');
  var now = Math.min(rows.length, settings.cap);
  if (!SmsTunnelKit.confirm(app, 'Send waiting texts?', rows.length + (rows.length === 1 ? ' row is' : ' rows are') + ' "' + settings.statusValue + '" with no text yet (row ' + shown + '). Text ' + now + ' of them now, one text per row?')) return;
  var summary = SmsTunnelKit.withLock(function () {
    return smstunnelProcessRows_(sheet, layout, settings, 2, sheet.getLastRow());
  }, 30000);
  if (summary.busy) {
    SmsTunnelKit.alert(app, 'Busy', 'Another run is texting rows right now. Try again in a minute.');
    return;
  }
  SmsTunnelKit.alert(app, 'Done', smstunnelSummaryText_(summary));
}

function smstunnelSendTestText() {
  SmsTunnelKit.sendTestText(SMSTUNNEL_APP, '');
}

function smstunnelTurnOff() {
  SmsTunnelKit.turnOff(SMSTUNNEL_APP);
  SmsTunnelKit.alert(SMSTUNNEL_APP, 'Texts are off', 'Status changes no longer send texts. Your settings and key are kept: Set up turns the texts on again.');
}

function smstunnelHelp() {
  var s = SmsTunnelKit.loadSettings() || {};
  var esc = SmsTunnelKit.escapeHtml;
  SmsTunnelKit.showHelp(
    SMSTUNNEL_APP,
    '<p>When ' + esc(s.statusColumn || 'the status column') + ' becomes "' + esc(s.statusValue || 'the value you choose') + '", the number in that row gets your text, once. "Texted at" shows when; a note on the cell shows the number and the message id.</p>' +
      '<ul><li>To text a row again, clear its "Texted at" cell and set the status again (or use Send waiting texts now).</li>' +
      '<li>Changes made by other apps or scripts don\'t run the edit trigger: turn on "Also check every 15 minutes" in Set up for those.</li>' +
      '<li>At most ' + esc(s.cap || SMSTUNNEL_STATUS.defaultCap) + ' texts go out per change or check; the rest wait for the next one.</li>' +
      '<li>Every text and every row that could not be texted is listed in the "SMSTunnel log" sheet.</li></ul>'
  );
}

// ─── The work ───────────────────────────────────────────────────────────────────────────────────────────────

function smstunnelLayout_(sheet, settings) {
  var headers = SmsTunnelKit.headersOf(sheet);
  var status = SmsTunnelKit.findColumn(headers, settings.statusColumn);
  var phone = SmsTunnelKit.findColumn(headers, settings.phoneColumn);
  var texted = SmsTunnelKit.findColumn(headers, settings.textedColumn);
  var missing = [];
  if (!status) missing.push(settings.statusColumn);
  if (!phone) missing.push(settings.phoneColumn);
  if (!texted) missing.push(settings.textedColumn);
  if (missing.length) {
    return {
      ok: false,
      problem: 'The sheet "' + sheet.getName() + '" has no column called "' + missing.join('", "') + '" any more. Open SMSTunnel → Set up and choose the columns again.',
    };
  }
  return { ok: true, sheet: sheet, headers: headers, status: status, phone: phone, texted: texted, width: Math.max(headers.length, status, phone, texted) };
}

function smstunnelMatches_(cell, settings) {
  return SmsTunnelKit.nameKey(cell) === SmsTunnelKit.nameKey(settings.statusValue);
}

/** Texts the rows from first to last whose status is the chosen value and that were not texted yet. */
function smstunnelProcessRows_(sheet, layout, settings, first, last) {
  var summary = { sent: 0, notSent: 0, waiting: 0, problem: '', stopped: '' };
  if (last < first) return summary;
  var count = last - first + 1;
  var display = sheet.getRange(first, 1, count, layout.width).getDisplayValues();
  var raw = sheet.getRange(first, layout.phone, count, 1).getValues();
  var cap = Number(settings.cap) || SMSTUNNEL_STATUS.defaultCap;
  for (var i = 0; i < count; i++) {
    var row = display[i];
    var rowNumber = first + i;
    if (!smstunnelMatches_(row[layout.status - 1], settings)) continue;
    if (!smstunnelPending_(row[layout.texted - 1])) continue;
    if (summary.sent >= cap) {
      summary.waiting++;
      continue;
    }
    var phone = SmsTunnelKit.phoneFromCell(raw[i][0], row[layout.phone - 1], settings.countryCode);
    if (!phone.ok) {
      smstunnelNotSent_(layout, rowNumber, String(row[layout.phone - 1]), phone.message, summary);
      continue;
    }
    var filled = SmsTunnelKit.fill(settings.message, SmsTunnelKit.valuesFrom(layout.headers, row));
    var text = filled.text.trim();
    if (filled.missing.length) {
      smstunnelNotSent_(layout, rowNumber, phone.number, 'the text uses {' + filled.missing.join('}, {') + '}, but the sheet has no such column.', summary);
      continue;
    }
    if (!text) {
      smstunnelNotSent_(layout, rowNumber, phone.number, 'the text is empty for this row.', summary);
      continue;
    }
    if (SmsTunnel.textLength(text) > 1600) {
      smstunnelNotSent_(layout, rowNumber, phone.number, 'the text is ' + SmsTunnel.textLength(text) + ' characters long (at most 1600).', summary);
      continue;
    }
    if (summary.sent > 0) SmsTunnelKit.pause();
    var once = smstunnelStartSending_(layout, rowNumber);
    var result = SmsTunnelKit.sendOne(phone.number, text, settings, once);
    if (result.ok) {
      var how = result.already ? 'SMSTunnel already had this text from an earlier try' : 'Message id: ' + result.messageId;
      smstunnelMark_(layout, rowNumber, new Date(), 'Texted ' + phone.number + (result.queued ? ' (your phone was offline: the text goes out when it is back online)' : '') + '\n' + how);
      SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + rowNumber, to: phone.number, result: result.queued ? 'Waiting for your phone' : 'Sent', details: how });
      summary.sent++;
      continue;
    }
    if (result.kind === 'row') {
      smstunnelNotSent_(layout, rowNumber, phone.number, result.explain, summary);
      continue;
    }
    SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + rowNumber, to: phone.number, result: 'Stopped', details: result.explain });
    if (result.kind === 'transient') summary.stopped = result.explain;
    else {
      summary.problem = result.explain;
      SmsTunnelKit.noteProblem(result.explain);
    }
    break;
  }
  if (summary.waiting) {
    SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Rows ' + first + '–' + last, result: 'Waiting', details: summary.waiting + ' more rows wait: at most ' + cap + ' texts go out at once.' });
  }
  return summary;
}

/** A row still to text: "Texted at" is empty, or says "Sending…" (a try that may not have gone through). */
function smstunnelPending_(cell) {
  var value = String(cell === undefined || cell === null ? '' : cell).trim();
  return value === '' || value === SmsTunnelKit.SENDING;
}

/**
 * Writes "Sending…" in the row with the key of this try in the note, before the text goes out. A later run that
 * finds "Sending…" sends with the same key, so SMSTunnel never texts the row twice; a cleared cell gets a new key.
 */
function smstunnelStartSending_(layout, rowNumber) {
  var cell = layout.sheet.getRange(rowNumber, layout.texted);
  var key = cell.getValue() === SmsTunnelKit.SENDING ? SmsTunnelKit.keyInNote(cell.getNote()) : '';
  if (!key) key = Utilities.getUuid();
  smstunnelMark_(layout, rowNumber, SmsTunnelKit.SENDING, 'SMSTunnel key: ' + key + '\nIf this stays here, the next check tries again with the same key.');
  return key;
}

function smstunnelMark_(layout, rowNumber, value, note) {
  var cell = layout.sheet.getRange(rowNumber, layout.texted);
  cell.setValue(value);
  if (typeof value !== 'string') cell.setNumberFormat('yyyy-mm-dd hh:mm');
  cell.setNote(note || '');
  SpreadsheetApp.flush();
}

function smstunnelNotSent_(layout, rowNumber, to, why, summary) {
  smstunnelMark_(layout, rowNumber, 'Not sent: ' + why, 'Clear this cell and set the status again to try once more.');
  SmsTunnelKit.log(SMSTUNNEL_APP, { where: 'Row ' + rowNumber, to: to, result: 'Not sent', details: why });
  summary.notSent++;
}

/** At setup: rows that already have the value are marked, so only changes from now on send texts. */
function smstunnelStampExisting_(sheet, layout, settings) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var rows = sheet.getRange(2, 1, last - 1, layout.width).getDisplayValues();
  var words = 'Skipped: already ' + settings.statusValue + ' before SMSTunnel was set up';
  var stamped = 0;
  var start = -1;
  function flush(end) {
    if (start < 0) return;
    var block = [];
    for (var r = start; r < end; r++) block.push([words]);
    sheet.getRange(start + 2, layout.texted, block.length, 1).setValues(block);
    start = -1;
  }
  for (var i = 0; i < rows.length; i++) {
    var hit = smstunnelMatches_(rows[i][layout.status - 1], settings) && String(rows[i][layout.texted - 1]).trim() === '';
    if (hit) {
      stamped++;
      if (start < 0) start = i;
    } else flush(i);
  }
  flush(rows.length);
  return stamped;
}

function smstunnelWaitingRows_(sheet, layout, settings) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, layout.width).getDisplayValues();
  var out = [];
  rows.forEach(function (row, i) {
    if (smstunnelMatches_(row[layout.status - 1], settings) && smstunnelPending_(row[layout.texted - 1])) out.push(i + 2);
  });
  return out;
}

function smstunnelReportLayout_(layout) {
  var last = SmsTunnelKit.lastProblem();
  if (last && last.text === layout.problem) return;
  SmsTunnelKit.noteProblem(layout.problem);
  SmsTunnelKit.log(SMSTUNNEL_APP, { result: 'Stopped', details: layout.problem });
}

function smstunnelFinish_(summary) {
  if (summary.busy) {
    console.warn(SMSTUNNEL_APP.name + ': another run held the spreadsheet for 30 s; the rows wait for the next change or check.');
    return;
  }
  console.log(SMSTUNNEL_APP.name + ': ' + smstunnelSummaryText_(summary));
  // Google emails you about a trigger run that fails, so a key that stopped working doesn't go unnoticed.
  if (summary.problem) throw new Error(SMSTUNNEL_APP.name + ': ' + summary.problem);
}

function smstunnelSummaryText_(summary) {
  var parts = [summary.sent + (summary.sent === 1 ? ' text sent' : ' texts sent')];
  if (summary.notSent) parts.push(summary.notSent + ' not sent (see the "SMSTunnel log" sheet)');
  if (summary.waiting) parts.push(summary.waiting + ' waiting for the next run');
  var text = parts.join(', ') + '.';
  if (summary.stopped) text += ' Stopped early: ' + summary.stopped;
  if (summary.problem) text += ' Stopped: ' + summary.problem;
  return text;
}
