/**
 * The parts every SMSTunnel template shares: settings, your key, triggers, the menu's dialogs, the log sheet and
 * the records that keep a text from going out twice. Texts themselves go through SmsTunnel.js.
 *
 * Where things are kept:
 *  - your API key and your settings: this project's user properties, which only you can read;
 *  - which setup is the one that sends: the document properties (one setup per spreadsheet or form, so two
 *    editors never send the same texts twice);
 *  - what was sent: the sheet itself ("Texted at", "Reminder sent"), the "SMSTunnel log" sheet and, for the
 *    calendar, the hidden "SMSTunnel sent" sheet.
 *
 * MIT License · Copyright (c) 2026 NARBOWEB SRL
 */
const SmsTunnelKit = (function () {
  'use strict';

  var SETTINGS_PROPERTY = 'SMSTUNNEL_SETTINGS';
  var SETUP_PROPERTY = 'SMSTUNNEL_SETUP_ID';
  var ACTIVE_SETUP_PROPERTY = 'SMSTUNNEL_ACTIVE_SETUP';
  var PROBLEM_PROPERTY = 'SMSTUNNEL_LAST_PROBLEM';
  var RECENT_PROPERTY = 'SMSTUNNEL_RECENT';
  var SEEN_PROPERTY = 'SMSTUNNEL_SEEN';
  var LOG_SHEET = 'SMSTunnel log';
  var SENT_SHEET = 'SMSTunnel sent';
  var LOG_HEADERS = ['When', 'Template', 'Where', 'To', 'Result', 'Details'];
  var SENT_HEADERS = ['Reminder id (do not edit)', 'Sent at', 'Starts'];
  var MAX_LOG_ROWS = 2000;
  /** A pause between two texts of one run: SMSTunnel takes up to 30 texts a minute. */
  var GAP_MS = 2000;
  var DASHBOARD_URL = 'https://dashboard.smstunnel.io/apps';
  var PLAY_URL = 'https://play.google.com/store/apps/details?id=io.smstunnel.app';
  var SITE_URL = 'https://smstunnel.io';
  var PLACEHOLDER = /\{\{\s*([^{}\r\n]{1,80}?)\s*\}\}|\{\s*([^{}\r\n]{1,80}?)\s*\}/g;
  var PAGE_CSS =
    'body{margin:0;padding:4px 6px;font:13px/1.5 Roboto,Arial,sans-serif;color:#202124}' +
    'h2{font-size:14px;font-weight:500;margin:14px 0 6px}p{margin:6px 0}ul{padding-left:18px;margin:6px 0}' +
    'li{margin:3px 0}.muted{color:#5f6368}.bad{color:#a50e0e}.good{color:#137333}a{color:#1a73e8}' +
    'table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #e8eaed;padding:5px 4px;' +
    'text-align:left;vertical-align:top}th{font-weight:500;color:#5f6368}.text{white-space:pre-wrap}';

  // ─── Settings and setup ─────────────────────────────────────────────────────────────────────────────────

  function loadSettings() {
    var raw = PropertiesService.getUserProperties().getProperty(SETTINGS_PROPERTY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveSettings(settings) {
    PropertiesService.getUserProperties().setProperty(SETTINGS_PROPERTY, JSON.stringify(settings));
  }

  /** Makes your setup the one that sends texts here. A setup made earlier by someone else stops. */
  function claimSetup() {
    var id = Utilities.getUuid();
    PropertiesService.getUserProperties().setProperty(SETUP_PROPERTY, id);
    PropertiesService.getDocumentProperties().setProperty(ACTIVE_SETUP_PROPERTY, id);
    return id;
  }

  /** 'mine' when your setup sends the texts here, 'other' when another editor's does, 'none' when no one's does. */
  function setupState() {
    var active = PropertiesService.getDocumentProperties().getProperty(ACTIVE_SETUP_PROPERTY);
    if (!active) return 'none';
    var mine = PropertiesService.getUserProperties().getProperty(SETUP_PROPERTY);
    return mine && mine === active ? 'mine' : 'other';
  }

  function releaseSetup() {
    if (setupState() === 'mine') PropertiesService.getDocumentProperties().deleteProperty(ACTIVE_SETUP_PROPERTY);
    PropertiesService.getUserProperties().deleteProperty(SETUP_PROPERTY);
  }

  /** Asks Google for every permission in appsscript.json before triggers are made (a trigger can't ask later). */
  function requireScopes() {
    if (typeof ScriptApp.requireAllScopes === 'function') ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  }

  // ─── Triggers ───────────────────────────────────────────────────────────────────────────────────────────

  function removeTriggers(handlers) {
    var removed = 0;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });
    return removed;
  }

  function countTriggers(handlers) {
    return ScriptApp.getProjectTriggers().filter(function (trigger) {
      return handlers.indexOf(trigger.getHandlerFunction()) >= 0;
    }).length;
  }

  function deleteTriggerOf(e) {
    if (!e || !e.triggerUid) return;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(trigger);
    });
  }

  /**
   * The start of every trigger run: your settings when your setup is the one that sends here. Otherwise (texts
   * turned off, or another editor set them up since) the trigger removes itself and nothing is sent.
   */
  function beginRun(e, app) {
    var settings = loadSettings();
    if (settings && settings.enabled === true && setupState() === 'mine') return settings;
    console.warn(app.name + ': this trigger is not part of the setup that sends texts here, so it removes itself.');
    deleteTriggerOf(e);
    return null;
  }

  function turnOff(app) {
    removeTriggers(app.handlers);
    var settings = loadSettings();
    if (settings) {
      settings.enabled = false;
      saveSettings(settings);
    }
    releaseSetup();
  }

  /** Runs fn while holding the document's lock, so two runs never text the same row or event. */
  function withLock(fn, waitMs) {
    var lock = LockService.getDocumentLock() || LockService.getScriptLock();
    if (!lock.tryLock(waitMs || 20000)) return { busy: true };
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  // ─── The menu's dialogs ─────────────────────────────────────────────────────────────────────────────────

  function ui(app) {
    return app.host === 'forms' ? FormApp.getUi() : SpreadsheetApp.getUi();
  }

  function docName(app) {
    return app.host === 'forms' ? FormApp.getActiveForm().getTitle() : SpreadsheetApp.getActiveSpreadsheet().getName();
  }

  function alert(app, title, text) {
    var u = ui(app);
    u.alert(title, text, u.ButtonSet.OK);
  }

  function confirm(app, title, text) {
    var u = ui(app);
    return u.alert(title, text, u.ButtonSet.YES_NO) === u.Button.YES;
  }

  function showDialog(app, file, title, width, height) {
    var output = HtmlService.createHtmlOutputFromFile(file).setWidth(width).setHeight(height);
    ui(app).showModalDialog(output, title);
  }

  function showPage(app, title, bodyHtml, width, height) {
    var html =
      '<!DOCTYPE html><html><head><base target="_blank"><meta charset="utf-8"><style>' + PAGE_CSS + '</style></head><body>' +
      bodyHtml +
      '</body></html>';
    ui(app).showModalDialog(HtmlService.createHtmlOutput(html).setWidth(width || 480).setHeight(height || 460), title);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(app, text) {
    if (app.host !== 'forms') SpreadsheetApp.getActiveSpreadsheet().toast(text, 'SMSTunnel', 6);
  }

  // ─── Your key ───────────────────────────────────────────────────────────────────────────────────────────

  function keyStatus() {
    return { saved: SmsTunnel.hasApiKey(), hint: SmsTunnel.apiKeyHint() };
  }

  /** Checks a key (the saved one when key is empty) and lists your phones, for the setup dialog. */
  function checkKey(key) {
    var apiKey = typeof key === 'string' ? key.trim() : '';
    if (!apiKey && !SmsTunnel.hasApiKey()) {
      return { ok: false, phones: [], message: 'Paste your SMSTunnel key first (Apps → Add an app in your SMSTunnel dashboard).' };
    }
    try {
      var phones = SmsTunnel.getPhones(apiKey ? { apiKey: apiKey } : undefined);
      return {
        ok: true,
        phones: phones,
        message: phones.length ? '' : 'The key works, but no phone is linked to your account yet: link one under Phones → Add phone.',
      };
    } catch (err) {
      return { ok: false, phones: [], message: explainError(err) };
    }
  }

  /** '' when the pasted key works (or nothing new was pasted and a key is saved), else the problem in words. */
  function keyProblem(key) {
    var apiKey = typeof key === 'string' ? key.trim() : '';
    if (!apiKey) return SmsTunnel.hasApiKey() ? '' : 'Paste your SMSTunnel key (Apps → Add an app in your SMSTunnel dashboard).';
    var check = checkKey(apiKey);
    return check.ok ? '' : check.message;
  }

  function saveKey(key) {
    var apiKey = typeof key === 'string' ? key.trim() : '';
    if (apiKey) SmsTunnel.setApiKey(apiKey);
  }

  function forgetKey() {
    SmsTunnel.clearApiKey('user');
  }

  // ─── Errors in plain words ──────────────────────────────────────────────────────────────────────────────

  function explainError(err) {
    if (!err) return 'Something went wrong.';
    var words = String(err.message || err).replace(/^SMSTunnel:\s*/, '');
    switch (err.code) {
      case 'NO_API_KEY':
        return 'No SMSTunnel key yet. Open SMSTunnel → Set up and paste the key from Apps → Add an app in your SMSTunnel dashboard.';
      case 'UNAUTHORIZED':
        return 'SMSTunnel did not accept the key (it may have been deleted). Create a new one under Apps → Add an app and paste it in SMSTunnel → Set up.';
      case 'PERMISSION_REQUIRED':
        return 'This key is not allowed to do that' + (err.permission ? ' (' + err.permission + ')' : '') + '. Create a new key under Apps → Add an app and paste it in Set up.';
      case 'DISABLED_BY_SUPPORT':
        return 'SMSTunnel support turned this key or phone off. Please write to SMSTunnel support.';
      case 'FORBIDDEN':
        return 'SMSTunnel refused: ' + words;
      case 'NOT_FOUND':
        return 'SMSTunnel could not find that (' + words + '). If you chose a phone in Set up, check that it is still linked under Phones.';
      case 'RATE_LIMITED':
        return 'Too many texts in a short time. The rest wait for the next run' + (err.retryAfter ? ' (SMSTunnel asked to wait ' + err.retryAfter + ' s)' : '') + '.';
      case 'SERVER_ERROR':
      case 'NETWORK_ERROR':
        return 'SMSTunnel could not be reached just now (' + words + '). It tries again on the next run.';
      default:
        return words;
    }
  }

  /** 'row' for a problem with one text, 'transient' for one that may go away, 'account' for one that stops all texts. */
  function problemKind(err) {
    if (err && err.retryable === true) return 'transient';
    var code = err && err.code;
    if (code === 'BAD_REQUEST' || code === 'INVALID_NUMBER' || code === 'MESSAGE_TOO_LONG' || code === 'NO_CODE') return 'row';
    return 'account';
  }

  /**
   * Sends one text and says how it went, without throwing for SMSTunnel's answers. settings.apiKey (a key pasted
   * in the dialog but not saved yet) is used only for the test buttons.
   */
  function sendOne(number, text, settings) {
    var options = {};
    if (settings && settings.deviceId) options.deviceId = settings.deviceId;
    if (settings && settings.apiKey) options.apiKey = settings.apiKey;
    try {
      var result = SmsTunnel.sendSms(number, text, Object.keys(options).length ? options : undefined);
      if (!options.apiKey) clearProblem();
      return { ok: true, messageId: result.messageId, queued: result.queued };
    } catch (err) {
      if (!err || err.name !== 'SmsTunnelError') throw err;
      return { ok: false, kind: problemKind(err), error: err, explain: explainError(err) };
    }
  }

  function pause() {
    Utilities.sleep(GAP_MS);
  }

  function noteProblem(text) {
    PropertiesService.getUserProperties().setProperty(
      PROBLEM_PROPERTY,
      JSON.stringify({ at: new Date().toISOString(), text: String(text).slice(0, 500) })
    );
  }

  function clearProblem() {
    var props = PropertiesService.getUserProperties();
    if (props.getProperty(PROBLEM_PROPERTY)) props.deleteProperty(PROBLEM_PROPERTY);
  }

  function lastProblem() {
    var raw = PropertiesService.getUserProperties().getProperty(PROBLEM_PROPERTY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // ─── Texts with {placeholders} ──────────────────────────────────────────────────────────────────────────

  function nameKey(name) {
    return String(name).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** The {names} used in a text, in order, each once. {{name}} works too. */
  function placeholders(template) {
    var names = [];
    String(template || '').replace(PLACEHOLDER, function (match, a, b) {
      var name = String(a || b).trim();
      if (names.indexOf(name) < 0) names.push(name);
      return match;
    });
    return names;
  }

  function unknownPlaceholders(template, known) {
    var keys = known.map(nameKey);
    return placeholders(template).filter(function (name) {
      return keys.indexOf(nameKey(name)) < 0;
    });
  }

  /**
   * Fills {names} from values (keyed by nameKey). Unknown names stay as they are and come back in missing. An
   * empty value takes the space before it along when punctuation follows: "Hi {Name}, ..." → "Hi, ...".
   */
  function fill(template, values) {
    var source = String(template || '');
    var missing = [];
    var out = '';
    var last = 0;
    var pattern = new RegExp(PLACEHOLDER.source, 'g');
    var match;
    while ((match = pattern.exec(source)) !== null) {
      var name = String(match[1] || match[2]);
      var key = nameKey(name);
      var before = source.slice(last, match.index);
      var value = match[0];
      if (Object.prototype.hasOwnProperty.call(values, key)) value = String(values[key]);
      else missing.push(name.trim());
      if (value === '') {
        var next = source.charAt(match.index + match[0].length);
        if (/[ \t]$/.test(before) && (next === '' || /[\s,.;:!?)]/.test(next))) before = before.replace(/[ \t]+$/, '');
      }
      out += before + value;
      last = match.index + match[0].length;
    }
    return { text: out + source.slice(last), missing: missing };
  }

  /** {header: cell} for fill(), from a header row and a row of cells. */
  function valuesFrom(names, cells) {
    var out = {};
    names.forEach(function (name, i) {
      if (String(name).trim()) out[nameKey(name)] = cells[i] === undefined || cells[i] === null ? '' : String(cells[i]);
    });
    return out;
  }

  function truncate(text, max) {
    var value = String(text);
    if (SmsTunnel.textLength(value) <= max) return value;
    var out = value.slice(0, Math.max(0, max - 1));
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
    while (out && SmsTunnel.textLength(out + '…') > max) out = out.slice(0, -1);
    return out + '…';
  }

  // ─── Numbers ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The number in a sheet cell. Google Sheets turns a typed +14155550123 into the number 14155550123 (dropping
   * the +) and 0722123456 into 722123456 (dropping the 0); a number cell that starts with your country code and
   * is long enough to carry one is read as international, any other number cell as local.
   */
  function phoneFromCell(raw, display, countryCode) {
    var shown = display === undefined || display === null ? '' : String(display).trim();
    if (typeof raw === 'number' && shown.indexOf('+') < 0) {
      var digits = String(raw);
      var cc = SmsTunnel.cleanCountryCode(countryCode || '');
      if (/^\d+$/.test(digits) && cc && digits.indexOf(cc.slice(1)) === 0 && digits.length >= 11) {
        return SmsTunnel.normalizePhone('+' + digits, cc);
      }
      return SmsTunnel.normalizePhone(digits, countryCode);
    }
    return SmsTunnel.normalizePhone(shown || (raw === null || raw === undefined ? '' : String(raw)), countryCode);
  }

  /** Your own numbers from a text box: one per line (or comma-separated), at most max. */
  function parseNumbers(text, countryCode, max) {
    var numbers = [];
    var problem = '';
    String(text || '')
      .split(/[\r\n,;]+/)
      .forEach(function (part) {
        var value = part.trim();
        if (!value || problem) return;
        var phone = SmsTunnel.normalizePhone(value, countryCode);
        if (!phone.ok) problem = phone.message;
        else if (numbers.indexOf(phone.number) < 0) numbers.push(phone.number);
      });
    if (!problem && numbers.length > max) problem = 'Up to ' + max + ' of your own numbers, please.';
    return { numbers: numbers, problem: problem };
  }

  /** +14155550123 → +141•••123, for the execution log. */
  function mask(number) {
    var value = String(number || '');
    return value.length <= 7 ? value : value.slice(0, 4) + '•••' + value.slice(-3);
  }

  // ─── Sheets ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A value written to a cell stays text: Google Sheets would read "=..." as a formula (a calendar event's title
   * comes from whoever sent the invite) and "+1415..." as a number.
   */
  function safeCell(value) {
    if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
    return value;
  }

  function headersOf(sheet) {
    var width = sheet.getLastColumn();
    if (width < 1) return [];
    return sheet
      .getRange(1, 1, 1, width)
      .getDisplayValues()[0]
      .map(function (header) {
        return String(header).trim();
      });
  }

  /** The column (from 1) whose header is name, ignoring case and extra spaces; 0 when there is none. */
  function findColumn(headers, name) {
    if (!name) return 0;
    var key = nameKey(name);
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] && nameKey(headers[i]) === key) return i + 1;
    }
    return 0;
  }

  function sheetById(id) {
    var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === String(id)) return sheets[i];
    }
    return null;
  }

  /** The column with this header; a new one after the last column when there is none. */
  function ensureColumn(sheet, name) {
    var headers = headersOf(sheet);
    var at = findColumn(headers, name);
    if (at) return at;
    var column = Math.max(sheet.getLastColumn(), 0) + 1;
    sheet.getRange(1, column).setValue(name).setFontWeight('bold');
    return column;
  }

  /** The sheets a template can work on: all but the ones SMSTunnel makes itself. */
  function dataSheets(skip) {
    var own = [LOG_SHEET, SENT_SHEET].concat(skip || []);
    return SpreadsheetApp.getActiveSpreadsheet()
      .getSheets()
      .filter(function (sheet) {
        return own.indexOf(sheet.getName()) < 0;
      });
  }

  /** Headers and the first data row of a sheet, for the setup dialog's lists and preview. */
  function describeSheet(sheet) {
    var headers = headersOf(sheet).slice(0, 60);
    var sample = [];
    if (sheet.getLastRow() >= 2 && headers.length) sample = sheet.getRange(2, 1, 1, headers.length).getDisplayValues()[0];
    return { id: String(sheet.getSheetId()), name: sheet.getName(), headers: headers, sample: sample };
  }

  function ownSheet(name, headers, hide) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
    var active = ss.getActiveSheet();
    sheet = ss.insertSheet(name, ss.getSheets().length);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (hide) sheet.hideSheet();
    if (active) ss.setActiveSheet(active);
    return sheet;
  }

  function logSheet() {
    return ownSheet(LOG_SHEET, LOG_HEADERS, false);
  }

  /** Adds a line to the "SMSTunnel log" sheet (it keeps the last 2000). */
  function log(app, entry) {
    var sheet = logSheet();
    sheet.appendRow([
      new Date(),
      app.short,
      safeCell(String(entry.where || '')),
      safeCell(String(entry.to || '')),
      safeCell(String(entry.result || '')),
      safeCell(String(entry.details || '')),
    ]);
    var extra = sheet.getLastRow() - 1 - MAX_LOG_ROWS;
    if (extra > 0) sheet.deleteRows(2, extra);
  }

  /**
   * What the calendar template already sent, kept in the hidden "SMSTunnel sent" sheet: one id per text, made of
   * the event, its start and the number. A moved event gets a new id, so its new time is texted once more.
   */
  function sentStore() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SENT_SHEET);
    var keys = {};
    if (sheet && sheet.getLastRow() > 1) {
      sheet
        .getRange(2, 1, sheet.getLastRow() - 1, 1)
        .getValues()
        .forEach(function (row) {
          if (row[0] !== '' && row[0] !== null) keys[String(row[0])] = true;
        });
    }
    return {
      has: function (key) {
        return keys[key] === true;
      },
      add: function (key, start) {
        if (!sheet) sheet = ownSheet(SENT_SHEET, SENT_HEADERS, true);
        sheet.appendRow([safeCell(key), new Date(), start || '']);
        keys[key] = true;
      },
    };
  }

  /** Forgets the sent ids of events that started before `before`, so the hidden sheet stays small. */
  function pruneSent(before) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SENT_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var count = sheet.getLastRow() - 1;
    var range = sheet.getRange(2, 1, count, 3);
    var rows = range.getValues();
    var keep = rows.filter(function (row) {
      return !(isDate(row[2]) && row[2].getTime() < before.getTime());
    });
    if (keep.length === rows.length) return 0;
    range.clearContent();
    if (keep.length) {
      sheet.getRange(2, 1, keep.length, 3).setValues(
        keep.map(function (row) {
          return [safeCell(String(row[0])), row[1], row[2]];
        })
      );
    }
    return rows.length - keep.length;
  }

  // ─── Forms: recent texts and responses already seen ─────────────────────────────────────────────────────

  function remember(entry) {
    var list = recent();
    list.unshift(entry);
    PropertiesService.getUserProperties().setProperty(RECENT_PROPERTY, JSON.stringify(list.slice(0, 20)));
  }

  function recent() {
    var raw = PropertiesService.getUserProperties().getProperty(RECENT_PROPERTY);
    if (!raw) return [];
    try {
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  /** True when this id came by before (an edited form response); remembers the last 400 ids. */
  function seenBefore(id) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(id), Utilities.Charset.UTF_8);
    var digest = Utilities.base64EncodeWebSafe(bytes).slice(0, 16);
    var props = PropertiesService.getUserProperties();
    var list = String(props.getProperty(SEEN_PROPERTY) || '')
      .split(' ')
      .filter(Boolean);
    if (list.indexOf(digest) >= 0) return true;
    list.unshift(digest);
    props.setProperty(SEEN_PROPERTY, list.slice(0, 400).join(' '));
    return false;
  }

  // ─── Dates and times ────────────────────────────────────────────────────────────────────────────────────

  function isDate(value) {
    return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function hourIn(date, timeZone) {
    return Number(Utilities.formatDate(date, timeZone, 'H'));
  }

  /** True outside the hours you allowed (from:00 to to:00). */
  function isQuiet(date, timeZone, from, to) {
    var hour = hourIn(date, timeZone);
    return hour < from || hour >= to;
  }

  /** The moment a day ('yyyy-MM-dd') and a time ('HH:mm') mean in a time zone. */
  function dateAt(day, time, timeZone) {
    return Utilities.parseDate(day + ' ' + time, timeZone, 'yyyy-MM-dd HH:mm');
  }

  // ─── Menu items every template has ──────────────────────────────────────────────────────────────────────

  function sendTestText(app, suggested) {
    var u = ui(app);
    if (!SmsTunnel.hasApiKey()) {
      alert(app, 'Set up first', 'Open SMSTunnel → Set up and paste your SMSTunnel key first.');
      return;
    }
    var settings = loadSettings() || {};
    var question =
      'Your own number, with the country code (like +14155550123).' + (suggested ? ' Leave it empty to use ' + suggested + '.' : '');
    var answer = u.prompt('Send a test text', question, u.ButtonSet.OK_CANCEL);
    if (answer.getSelectedButton() !== u.Button.OK) return;
    var value = answer.getResponseText().trim() || suggested || '';
    var phone = SmsTunnel.normalizePhone(value, settings.countryCode);
    if (!phone.ok) {
      alert(app, 'No test text sent', phone.message);
      return;
    }
    var result = sendOne(phone.number, 'SMSTunnel test from "' + truncate(docName(app), 60) + '": it works.', settings);
    if (!result.ok) {
      alert(app, 'No test text sent', result.explain);
      return;
    }
    alert(
      app,
      'Test text sent',
      result.queued
        ? 'Your phone is offline, so the text waits and goes out as soon as the phone is back online.'
        : 'Your phone is sending it to ' + phone.number + ' now.'
    );
  }

  /** The Help dialog: what the template does, its state, and where to change things. */
  function showHelp(app, aboutHtml) {
    var settings = loadSettings();
    var state = setupState();
    var key = keyStatus();
    var problem = lastProblem();
    var on = state === 'mine' && settings && settings.enabled === true && countTriggers(app.handlers) > 0;
    var docWord = app.host === 'forms' ? 'form' : 'spreadsheet';
    var status = on
      ? '<span class="good">On.</span>'
      : state === 'other'
      ? 'Set up by another person who can edit this ' + docWord + '. Their setup sends the texts; if you set it up too, yours takes over.'
      : 'Off. Open SMSTunnel → Set up to turn them on.';
    var html =
      '<h2>' + escapeHtml(app.name) + '</h2>' +
      aboutHtml +
      '<h2>Right now</h2><ul>' +
      '<li>Texts: ' + status + '</li>' +
      '<li>Your key: ' + (key.saved ? 'saved (' + escapeHtml(key.hint) + ')' : 'not saved yet') + '</li>' +
      (problem ? '<li class="bad">Last problem (' + escapeHtml(String(problem.at).slice(0, 16).replace('T', ' ')) + ' UTC): ' + escapeHtml(problem.text) + '</li>' : '') +
      '</ul>' +
      '<h2>Good to know</h2><ul>' +
      '<li>Each text goes out from your own Android phone, from your own number, one number per text. The phone needs the <a href="' + PLAY_URL + '">SMSTunnel app</a>.</li>' +
      '<li>Your key is kept in this script\'s user properties, which only you can read. To stop everything at once, delete the key under <a href="' + DASHBOARD_URL + '">Apps</a> in your SMSTunnel dashboard.</li>' +
      '<li>SMSTunnel → Turn texts off removes the triggers. Extensions → Apps Script → Triggers shows them.</li>' +
      '<li>Only text people who gave you their number for these texts.</li>' +
      '</ul><p class="muted"><a href="' + SITE_URL + '">smstunnel.io</a> · SMSTunnel is not affiliated with, endorsed by, or sponsored by Google.</p>';
    showPage(app, 'SMSTunnel help', html, 500, 520);
  }

  return Object.freeze({
    GAP_MS: GAP_MS,
    LOG_SHEET: LOG_SHEET,
    SENT_SHEET: SENT_SHEET,
    DASHBOARD_URL: DASHBOARD_URL,
    PLAY_URL: PLAY_URL,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    claimSetup: claimSetup,
    setupState: setupState,
    releaseSetup: releaseSetup,
    requireScopes: requireScopes,
    removeTriggers: removeTriggers,
    countTriggers: countTriggers,
    deleteTriggerOf: deleteTriggerOf,
    beginRun: beginRun,
    turnOff: turnOff,
    withLock: withLock,
    ui: ui,
    docName: docName,
    alert: alert,
    confirm: confirm,
    showDialog: showDialog,
    showPage: showPage,
    escapeHtml: escapeHtml,
    toast: toast,
    keyStatus: keyStatus,
    checkKey: checkKey,
    keyProblem: keyProblem,
    saveKey: saveKey,
    forgetKey: forgetKey,
    explainError: explainError,
    problemKind: problemKind,
    sendOne: sendOne,
    pause: pause,
    noteProblem: noteProblem,
    clearProblem: clearProblem,
    lastProblem: lastProblem,
    nameKey: nameKey,
    placeholders: placeholders,
    unknownPlaceholders: unknownPlaceholders,
    fill: fill,
    valuesFrom: valuesFrom,
    truncate: truncate,
    phoneFromCell: phoneFromCell,
    parseNumbers: parseNumbers,
    mask: mask,
    safeCell: safeCell,
    headersOf: headersOf,
    findColumn: findColumn,
    sheetById: sheetById,
    ensureColumn: ensureColumn,
    dataSheets: dataSheets,
    describeSheet: describeSheet,
    ownSheet: ownSheet,
    logSheet: logSheet,
    log: log,
    sentStore: sentStore,
    pruneSent: pruneSent,
    remember: remember,
    recent: recent,
    seenBefore: seenBefore,
    isDate: isDate,
    pad: pad,
    hourIn: hourIn,
    isQuiet: isQuiet,
    dateAt: dateAt,
    sendTestText: sendTestText,
    showHelp: showHelp,
  });
})();
