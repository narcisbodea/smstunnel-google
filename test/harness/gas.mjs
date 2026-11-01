/**
 * A small Apps Script runtime for the tests. It loads a project's files from apps-script/<name>/ into one vm
 * context (one global scope, like Apps Script) with shims for the services the projects use:
 * UrlFetchApp (a recorded mock, or the real local SMSTunnel API through a synchronous fetch), PropertiesService,
 * Utilities, Session, LockService, ScriptApp (triggers), HtmlService, SpreadsheetApp, FormApp and CalendarApp,
 * plus console and Logger, recorded.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createSyncFetch } from './sync-fetch.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─── Dates in a time zone (SimpleDateFormat-like, as Utilities.formatDate does) ───────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const partsCache = new Map();

function partsIn(date, timeZone) {
  let format = partsCache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsCache.set(timeZone, format);
  }
  const out = {};
  for (const part of format.formatToParts(date)) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(out.weekday),
  };
}

function offsetAt(instant, timeZone) {
  const p = partsIn(new Date(instant), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time means in a time zone. */
export function zoned(year, month, day, hour = 0, minute = 0, second = 0, timeZone = 'Etc/UTC') {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wall - offsetAt(wall, timeZone);
  const again = wall - offsetAt(guess, timeZone);
  if (again !== guess) guess = again;
  return new Date(guess);
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

export function formatDate(date, timeZone, pattern) {
  if (!(date instanceof Date) && Object.prototype.toString.call(date) !== '[object Date]') throw new Error('Exception: formatDate needs a Date');
  const p = partsIn(date, timeZone);
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i];
    if (ch === "'") {
      const end = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, end < 0 ? pattern.length : end);
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    let run = 1;
    while (pattern[i + run] === ch) run++;
    i += run;
    switch (ch) {
      case 'y': out += run === 2 ? pad(p.year % 100) : String(p.year); break;
      case 'M': out += run >= 4 ? MONTHS[p.month - 1] : run === 3 ? MONTHS[p.month - 1].slice(0, 3) : run === 2 ? pad(p.month) : String(p.month); break;
      case 'd': out += run === 2 ? pad(p.day) : String(p.day); break;
      case 'H': out += run === 2 ? pad(p.hour) : String(p.hour); break;
      case 'h': { const h = p.hour % 12 || 12; out += run === 2 ? pad(h) : String(h); break; }
      case 'm': out += run === 2 ? pad(p.minute) : String(p.minute); break;
      case 's': out += run === 2 ? pad(p.second) : String(p.second); break;
      case 'a': out += p.hour < 12 ? 'AM' : 'PM'; break;
      case 'E': out += run >= 4 ? DAYS[p.weekday] : DAYS[p.weekday].slice(0, 3); break;
      default:
        if (/[A-Za-z]/.test(ch)) throw new Error('formatDate shim: pattern letter ' + ch + ' is not supported');
        out += ch.repeat(run);
    }
  }
  return out;
}

export function parseDate(text, timeZone, pattern) {
  const known = {
    'yyyy-MM-dd HH:mm': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,
    'yyyy-MM-dd HH:mm:ss': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    'yyyy-MM-dd': /^(\d{4})-(\d{2})-(\d{2})$/,
  };
  const re = known[pattern];
  if (!re) throw new Error('parseDate shim: pattern ' + pattern + ' is not supported');
  const m = re.exec(text);
  if (!m) throw new Error('Exception: Unparseable date: "' + text + '"');
  return zoned(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0), timeZone);
}

/** Google Sheets number formats to the formatDate patterns above (only what the projects use). */
function sheetsFormatToPattern(format) {
  if (format === 'yyyy-mm-dd hh:mm') return 'yyyy-MM-dd HH:mm';
  return null;
}

// ─── Properties ─────────────────────────────────────────────────────────────────────────────────────────

class Properties {
  constructor() {
    this.map = new Map();
  }
  getProperty(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setProperty(key, value) {
    const text = String(value);
    if (Buffer.byteLength(key) + Buffer.byteLength(text) > 9 * 1024) throw new Error('Exception: Argument too large: value');
    this.map.set(key, text);
    return this;
  }
  deleteProperty(key) {
    this.map.delete(key);
    return this;
  }
  getProperties() {
    return Object.fromEntries(this.map);
  }
  getKeys() {
    return [...this.map.keys()];
  }
  setProperties(values, deleteAllOthers) {
    if (deleteAllOthers) this.map.clear();
    for (const [k, v] of Object.entries(values)) this.setProperty(k, v);
    return this;
  }
  deleteAllProperties() {
    this.map.clear();
    return this;
  }
}

// ─── UI ─────────────────────────────────────────────────────────────────────────────────────────────────

class Ui {
  constructor() {
    this.menus = [];
    this.alerts = [];
    this.prompts = [];
    this.dialogs = [];
    this.answers = [];
    this.promptAnswers = [];
    this.ButtonSet = { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' };
    this.Button = { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' };
  }
  createMenu(name) {
    const menu = { name, items: [] };
    const builder = {
      addItem: (caption, fn) => {
        menu.items.push({ caption, fn });
        return builder;
      },
      addSeparator: () => {
        menu.items.push({ separator: true });
        return builder;
      },
      addToUi: () => {
        this.menus.push(menu);
      },
    };
    return builder;
  }
  alert(...args) {
    const [title, text, buttons] = args.length === 1 ? ['', args[0], 'OK'] : args.length === 2 ? ['', args[0], args[1]] : args;
    this.alerts.push({ title, text, buttons });
    if (this.answers.length) return this.answers.shift();
    return buttons === 'YES_NO' || buttons === 'YES_NO_CANCEL' ? 'YES' : 'OK';
  }
  prompt(...args) {
    const [title, text] = args.length >= 2 ? args : ['', args[0]];
    this.prompts.push({ title, text });
    const answer = this.promptAnswers.shift() || { button: 'CANCEL', text: '' };
    return { getSelectedButton: () => answer.button, getResponseText: () => answer.text };
  }
  showModalDialog(output, title) {
    this.dialogs.push({ title, html: output.getContent(), width: output.width, height: output.height });
  }
  showSidebar(output) {
    this.dialogs.push({ sidebar: true, html: output.getContent() });
  }
}

class HtmlOutput {
  constructor(content) {
    this.content = content;
  }
  setWidth(w) {
    this.width = w;
    return this;
  }
  setHeight(h) {
    this.height = h;
    return this;
  }
  setTitle(t) {
    this.title = t;
    return this;
  }
  setSandboxMode() {
    return this;
  }
  getContent() {
    return this.content;
  }
}

// ─── Spreadsheets ───────────────────────────────────────────────────────────────────────────────────────

let nextSheetId = 1000;

function isDateValue(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

/** What Google Sheets stores when a script writes a value: "'x" is text, "=x" a formula, "+123" a number. */
function storeValue(value, sheet) {
  if (value === null || value === undefined) return { v: '' };
  if (typeof value === 'string') {
    if (value.startsWith("'")) return { v: value.slice(1) };
    if (value.startsWith('=')) {
      sheet.formulas.push(value);
      return { v: '#FORMULA', formula: value };
    }
    if (/^[+-]?\d+(\.\d+)?$/.test(value.trim())) return { v: Number(value) };
    return { v: value };
  }
  return { v: value };
}

class Sheet {
  constructor(spreadsheet, name, rows = []) {
    this.spreadsheet = spreadsheet;
    this.name = name;
    this.id = nextSheetId++;
    this.cells = [];
    this.hidden = false;
    this.frozenRows = 0;
    this.formulas = [];
    this.bold = [];
    rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        const target = this.cell(r + 1, c + 1);
        if (cell && typeof cell === 'object' && !isDateValue(cell) && 'v' in cell) {
          target.v = cell.v;
          if (cell.d !== undefined) target.d = cell.d;
        } else target.v = cell === null || cell === undefined ? '' : cell;
      })
    );
  }
  cell(r, c) {
    while (this.cells.length < r) this.cells.push([]);
    const row = this.cells[r - 1];
    while (row.length < c) row.push({ v: '' });
    return row[c - 1];
  }
  peek(r, c) {
    const row = this.cells[r - 1];
    return row && row[c - 1] ? row[c - 1] : { v: '' };
  }
  getName() {
    return this.name;
  }
  setName(name) {
    this.name = name;
    return this;
  }
  getSheetId() {
    return this.id;
  }
  getParent() {
    return this.spreadsheet;
  }
  getLastRow() {
    for (let r = this.cells.length; r >= 1; r--) if (this.cells[r - 1].some((cell) => cell.v !== '')) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((row) =>
      row.forEach((cell, c) => {
        if (cell.v !== '') max = Math.max(max, c + 1);
      })
    );
    return max;
  }
  getRange(row, column, numRows = 1, numColumns = 1) {
    if (typeof row !== 'number') throw new Error('Range shim: use numeric getRange(row, column, rows, columns)');
    if (row < 1 || column < 1 || numRows < 1 || numColumns < 1) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
    return new Range(this, row, column, numRows, numColumns);
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    values.forEach((value, c) => Object.assign(this.cell(row, c + 1), storeValue(value, this), { d: undefined }));
    return this;
  }
  deleteRows(start, count) {
    this.cells.splice(start - 1, count);
  }
  setFrozenRows(n) {
    this.frozenRows = n;
  }
  hideSheet() {
    this.hidden = true;
    return this;
  }
  isSheetHidden() {
    return this.hidden;
  }
  /** Test helper: the display values of the whole sheet. */
  table() {
    const out = [];
    for (let r = 1; r <= this.getLastRow(); r++) {
      const row = [];
      for (let c = 1; c <= this.getLastColumn(); c++) row.push(this.display(this.peek(r, c)));
      out.push(row);
    }
    return out;
  }
  display(cell) {
    if (cell.d !== undefined) return cell.d;
    const v = cell.v;
    if (isDateValue(v)) return formatDate(v, this.spreadsheet.timeZone, sheetsFormatToPattern(cell.format) || 'M/d/yyyy H:mm:ss');
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v === '' ? '' : String(v);
  }
}

class Range {
  constructor(sheet, row, column, numRows, numColumns) {
    Object.assign(this, { sheet, row, column, numRows, numColumns });
  }
  each(fn) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numColumns; c++) fn(this.sheet.cell(this.row + r, this.column + c), r, c);
  }
  grid(map) {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numColumns; c++) row.push(map(this.sheet.peek(this.row + r, this.column + c)));
      out.push(row);
    }
    return out;
  }
  getValues() {
    return this.grid((cell) => (isDateValue(cell.v) ? new Date(cell.v.getTime()) : cell.v));
  }
  getDisplayValues() {
    return this.grid((cell) => this.sheet.display(cell));
  }
  getValue() {
    return this.getValues()[0][0];
  }
  getDisplayValue() {
    return this.getDisplayValues()[0][0];
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((row) => row.length !== this.numColumns)) {
      throw new Error('Exception: The number of rows or columns in the data does not match the range.');
    }
    this.each((cell, r, c) => Object.assign(cell, storeValue(values[r][c], this.sheet), { d: undefined }));
    return this;
  }
  setValue(value) {
    this.each((cell) => Object.assign(cell, storeValue(value, this.sheet), { d: undefined }));
    return this;
  }
  clearContent() {
    this.each((cell) => Object.assign(cell, { v: '', d: undefined, formula: undefined }));
    return this;
  }
  setNote(note) {
    this.each((cell) => {
      cell.note = note;
    });
    return this;
  }
  getNote() {
    return this.sheet.peek(this.row, this.column).note || '';
  }
  setNumberFormat(format) {
    this.each((cell) => {
      cell.format = format;
    });
    return this;
  }
  setFontWeight(weight) {
    this.sheet.bold.push({ row: this.row, column: this.column, weight });
    return this;
  }
  getRow() {
    return this.row;
  }
  getColumn() {
    return this.column;
  }
  getNumRows() {
    return this.numRows;
  }
  getNumColumns() {
    return this.numColumns;
  }
  getLastRow() {
    return this.row + this.numRows - 1;
  }
  getLastColumn() {
    return this.column + this.numColumns - 1;
  }
  getSheet() {
    return this.sheet;
  }
}

class Spreadsheet {
  constructor({ name = 'Test sheet', timeZone = 'Etc/UTC', sheets = [{ name: 'Sheet1', rows: [] }] } = {}) {
    this.name = name;
    this.timeZone = timeZone;
    this.id = 'ss-' + randomUUID().slice(0, 8);
    this.sheets = sheets.map((s) => new Sheet(this, s.name, s.rows || []));
    this.active = this.sheets[0];
    this.toasts = [];
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getSpreadsheetTimeZone() {
    return this.timeZone;
  }
  getSheets() {
    return [...this.sheets];
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.name === name) || null;
  }
  insertSheet(name, index) {
    if (this.getSheetByName(name)) throw new Error('Exception: A sheet with the name "' + name + '" already exists.');
    const sheet = new Sheet(this, name);
    if (index === undefined) this.sheets.push(sheet);
    else this.sheets.splice(index, 0, sheet);
    this.active = sheet;
    return sheet;
  }
  getActiveSheet() {
    return this.active;
  }
  setActiveSheet(sheet) {
    this.active = sheet;
    return sheet;
  }
  toast(text, title) {
    this.toasts.push({ text, title });
  }
}

// ─── Forms ──────────────────────────────────────────────────────────────────────────────────────────────

const ITEM_TYPES = [
  'TEXT', 'PARAGRAPH_TEXT', 'MULTIPLE_CHOICE', 'CHECKBOX', 'LIST', 'SCALE', 'RATING', 'GRID', 'CHECKBOX_GRID', 'DATE', 'TIME',
  'DATETIME', 'DURATION', 'FILE_UPLOAD', 'SECTION_HEADER', 'PAGE_BREAK', 'IMAGE', 'VIDEO',
];

class Form {
  constructor({ title = 'Test form', items = [] } = {}) {
    this.title = title;
    this.id = 'form-' + randomUUID().slice(0, 8);
    this.items = items.map((item, i) => ({ id: item.id || 1000 + i, title: item.title, type: item.type || 'TEXT', index: i }));
  }
  getId() {
    return this.id;
  }
  getTitle() {
    return this.title;
  }
  getItems() {
    return this.items.map((item) => itemObject(item));
  }
  getItemById(id) {
    const item = this.items.find((i) => String(i.id) === String(id));
    return item ? itemObject(item) : null;
  }
  /** Test helper: a FormResponse with answers {title: value}. */
  response({ id = 'resp-' + randomUUID(), answers = {}, email = '', timestamp = new Date() } = {}) {
    const itemResponses = Object.entries(answers).map(([title, value]) => {
      const item = this.items.find((i) => i.title === title);
      if (!item) throw new Error('No question ' + title);
      return { getItem: () => itemObject(item), getResponse: () => value };
    });
    return { getId: () => id, getTimestamp: () => timestamp, getRespondentEmail: () => email, getItemResponses: () => itemResponses };
  }
}

function itemObject(item) {
  return { getId: () => item.id, getTitle: () => item.title, getType: () => item.type, getIndex: () => item.index };
}

// ─── Calendars ──────────────────────────────────────────────────────────────────────────────────────────

class CalendarEvent {
  constructor(calendar, spec, scriptTimeZone) {
    this.calendar = calendar;
    this.spec = spec;
    this.scriptTimeZone = scriptTimeZone;
    if (spec.allDay) {
      const [y, m, d] = spec.allDay.split('-').map(Number);
      this.start = zoned(y, m, d, 0, 0, 0, calendar.timeZone);
      this.end = zoned(y, m, d + (spec.days || 1), 0, 0, 0, calendar.timeZone);
    } else {
      this.start = new Date(spec.start);
      this.end = new Date(spec.end || new Date(this.start.getTime() + 3600000));
    }
  }
  getId() {
    return this.spec.id;
  }
  getTitle() {
    return this.spec.title || '';
  }
  getDescription() {
    return this.spec.description || '';
  }
  getLocation() {
    return this.spec.location || '';
  }
  getStartTime() {
    return new Date(this.start.getTime());
  }
  getEndTime() {
    return new Date(this.end.getTime());
  }
  isAllDayEvent() {
    return !!this.spec.allDay;
  }
  getAllDayStartDate() {
    if (!this.spec.allDay) throw new Error('Exception: not an all-day event');
    const [y, m, d] = this.spec.allDay.split('-').map(Number);
    return zoned(y, m, d, 0, 0, 0, this.scriptTimeZone);
  }
  getMyStatus() {
    return this.spec.myStatus || 'OWNER';
  }
  getGuestList() {
    return (this.spec.guests || []).map((g) => ({
      getEmail: () => g.email,
      getName: () => g.name || g.email,
      getGuestStatus: () => g.status || 'INVITED',
    }));
  }
  isRecurringEvent() {
    return !!this.spec.recurring;
  }
}

class Calendar {
  constructor(spec, scriptTimeZone) {
    this.id = spec.id;
    this.name = spec.name || spec.id;
    this.timeZone = spec.timeZone || 'Etc/UTC';
    this.primary = !!spec.primary;
    this.events = (spec.events || []).map((e) => new CalendarEvent(this, e, scriptTimeZone));
    this.reads = 0;
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getTimeZone() {
    return this.timeZone;
  }
  isMyPrimaryCalendar() {
    return this.primary;
  }
  isOwnedByMe() {
    return true;
  }
  getEvents(start, end) {
    this.reads++;
    return this.events
      .filter((e) => e.start.getTime() < end.getTime() && e.end.getTime() > start.getTime())
      .sort((a, b) => a.start - b.start);
  }
  /** Test helper. */
  add(spec, scriptTimeZone = 'Etc/UTC') {
    this.events.push(new CalendarEvent(this, spec, scriptTimeZone));
  }
}

// ─── The runtime ────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} options
 *   project      folder under apps-script/
 *   http         'local' (the local SMSTunnel API) or a function (request) → {status, body, headers} | {throw}
 *   timeZone     the script's time zone
 *   spreadsheet  {name, timeZone, sheets: [{name, rows}]} for a spreadsheet-bound project
 *   form         {title, items: [{id, title, type}]} for a form-bound project
 *   calendars    [{id, name, timeZone, primary, events: [...]}]
 *   reverseLoad  load the files in reverse order (load order must not matter)
 */
export function createGas(options = {}) {
  const project = options.project;
  const dir = join(ROOT, 'apps-script', project);
  if (!existsSync(dir)) throw new Error('No project ' + dir);
  const timeZone = options.timeZone || 'Etc/UTC';
  const logs = [];
  const requests = [];
  const sleeps = [];
  const scopeChecks = [];
  const ui = new Ui();
  const scriptProps = new Properties();
  const documentProps = options.spreadsheet || options.form ? new Properties() : null;
  const userProps = new Map();
  const triggers = [];
  let user = 'owner';
  let uid = 1;
  const locks = { blocked: false };
  const spreadsheet = options.spreadsheet ? new Spreadsheet(options.spreadsheet) : null;
  const form = options.form ? new Form(options.form) : null;
  const calendars = (options.calendars || []).map((c) => new Calendar(c, timeZone));
  let syncFetch = null;

  const propsFor = (who) => {
    if (!userProps.has(who)) userProps.set(who, new Properties());
    return userProps.get(who);
  };

  const record = (level) => (...args) => logs.push({ level, text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });

  function http(url, params = {}) {
    const method = String(params.method || 'get').toUpperCase();
    const headers = { ...(params.headers || {}) };
    if (params.contentType) headers['Content-Type'] = params.contentType;
    const request = { url, method, headers, payload: params.payload, params };
    requests.push(request);
    let answer;
    if (options.http === 'local') {
      if (!syncFetch) syncFetch = createSyncFetch();
      const res = syncFetch.fetch({ url, method, headers, body: params.payload, redirect: params.followRedirects === false ? 'manual' : 'follow' });
      if (res.error) throw new Error('Exception: Address unavailable: ' + url + ' (' + res.error + ')');
      answer = res;
    } else {
      const handler = options.http || (() => ({ status: 200, body: { success: true } }));
      const out = handler(request);
      if (out && out.throw) throw new Error('Exception: ' + out.throw);
      answer = { status: out.status || 200, headers: out.headers || {}, body: typeof out.body === 'string' ? out.body : out.body === undefined ? '' : JSON.stringify(out.body) };
    }
    if (params.muteHttpExceptions !== true && answer.status >= 400) {
      throw new Error('Exception: Request failed for ' + url + ' returned code ' + answer.status + '. Truncated server response: ' + answer.body.slice(0, 100));
    }
    return {
      getResponseCode: () => answer.status,
      getContentText: () => answer.body,
      getHeaders: () => ({ ...answer.headers }),
      getAllHeaders: () => ({ ...answer.headers }),
    };
  }

  const lockObject = () => {
    let held = false;
    return {
      tryLock: () => {
        if (locks.blocked) return false;
        held = true;
        return true;
      },
      waitLock: () => {
        if (locks.blocked) throw new Error('Exception: Lock timeout');
        held = true;
      },
      releaseLock: () => {
        held = false;
      },
      hasLock: () => held,
    };
  };

  function newTrigger(handler) {
    const spec = { handler, user };
    const create = () => {
      if (triggers.filter((t) => t.user === user).length >= 20) throw new Error('Exception: This script has too many triggers.');
      const trigger = {
        ...spec,
        id: 'trigger-' + uid++,
        getHandlerFunction: () => spec.handler,
        getUniqueId: () => trigger.id,
        getEventType: () => spec.event,
        getTriggerSource: () => spec.source,
      };
      triggers.push(trigger);
      return trigger;
    };
    const clock = {
      everyMinutes(n) {
        if (![1, 5, 10, 15, 30].includes(n)) throw new Error('Exception: everyMinutes takes 1, 5, 10, 15 or 30');
        spec.everyMinutes = n;
        return clock;
      },
      everyHours(n) {
        if (![1, 2, 4, 6, 8, 12].includes(n)) throw new Error('Exception: everyHours takes 1, 2, 4, 6, 8 or 12');
        spec.everyHours = n;
        return clock;
      },
      everyDays(n) {
        spec.everyDays = n;
        return clock;
      },
      atHour(h) {
        if (!(h >= 0 && h <= 23)) throw new Error('Exception: atHour takes 0 to 23');
        spec.atHour = h;
        return clock;
      },
      nearMinute(m) {
        spec.nearMinute = m;
        return clock;
      },
      inTimezone(tz) {
        spec.inTimezone = tz;
        return clock;
      },
      create,
    };
    return {
      forForm(target) {
        spec.source = 'FORMS';
        spec.sourceId = target.getId();
        return { onFormSubmit: () => ((spec.event = 'ON_FORM_SUBMIT'), { create }), onOpen: () => ((spec.event = 'ON_OPEN'), { create }) };
      },
      forSpreadsheet(target) {
        spec.source = 'SPREADSHEETS';
        spec.sourceId = target.getId();
        return {
          onEdit: () => ((spec.event = 'ON_EDIT'), { create }),
          onChange: () => ((spec.event = 'ON_CHANGE'), { create }),
          onOpen: () => ((spec.event = 'ON_OPEN'), { create }),
          onFormSubmit: () => ((spec.event = 'ON_FORM_SUBMIT'), { create }),
        };
      },
      timeBased() {
        spec.source = 'CLOCK';
        spec.event = 'CLOCK';
        return clock;
      },
    };
  }

  const sandbox = {
    console: { log: record('log'), info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') },
    Logger: { log: record('logger') },
    UrlFetchApp: { fetch: http },
    PropertiesService: {
      getScriptProperties: () => scriptProps,
      getUserProperties: () => propsFor(user),
      getDocumentProperties: () => documentProps,
    },
    Utilities: {
      sleep: (ms) => sleeps.push(ms),
      formatDate,
      parseDate,
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => [...createHash(algorithm).update(String(value), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes) : bytes.map((b) => (b + 256) % 256)).toString('base64'),
      base64EncodeWebSafe: (bytes) =>
        Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes) : bytes.map((b) => (b + 256) % 256))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_'),
    },
    Session: {
      getScriptTimeZone: () => timeZone,
      getActiveUser: () => ({ getEmail: () => user + '@example.com' }),
      getEffectiveUser: () => ({ getEmail: () => user + '@example.com' }),
    },
    LockService: { getDocumentLock: () => (spreadsheet || form ? lockObject() : null), getScriptLock: lockObject, getUserLock: lockObject },
    ScriptApp: {
      AuthMode: { FULL: 'FULL', LIMITED: 'LIMITED', NONE: 'NONE', CUSTOM_FUNCTION: 'CUSTOM_FUNCTION' },
      requireAllScopes: (mode) => scopeChecks.push(mode),
      newTrigger,
      getProjectTriggers: () => triggers.filter((t) => t.user === user),
      deleteTrigger: (trigger) => {
        const at = triggers.findIndex((t) => t.id === trigger.getUniqueId());
        if (at >= 0) triggers.splice(at, 1);
      },
    },
    HtmlService: {
      createHtmlOutputFromFile: (name) => {
        const path = join(dir, name + '.html');
        if (!existsSync(path)) throw new Error('Exception: No HTML file named ' + name + ' was found.');
        return new HtmlOutput(readFileSync(path, 'utf8'));
      },
      createHtmlOutput: (html) => new HtmlOutput(html || ''),
      SandboxMode: { IFRAME: 'IFRAME' },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getActive: () => spreadsheet,
      getUi: () => ui,
      flush: () => {},
    },
    FormApp: {
      getActiveForm: () => form,
      getUi: () => ui,
      ItemType: Object.fromEntries(ITEM_TYPES.map((t) => [t, t])),
    },
    CalendarApp: {
      getDefaultCalendar: () => calendars.find((c) => c.primary) || calendars[0] || null,
      getCalendarById: (id) => calendars.find((c) => c.id === id) || null,
      getAllCalendars: () => [...calendars],
      getAllOwnedCalendars: () => [...calendars],
      GuestStatus: { INVITED: 'INVITED', MAYBE: 'MAYBE', NO: 'NO', OWNER: 'OWNER', YES: 'YES' },
    },
  };
  const context = vm.createContext(sandbox);

  const order = JSON.parse(readFileSync(join(dir, '.clasp.json.example'), 'utf8')).filePushOrder;
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) if (!order.includes(f)) order.push(f);
  if (options.reverseLoad) order.reverse();
  for (const file of order) vm.runInContext(readFileSync(join(dir, file), 'utf8'), context, { filename: join(project, file) });

  return {
    context,
    spreadsheet,
    form,
    calendars,
    ui,
    logs,
    requests,
    sleeps,
    triggers,
    scopeChecks,
    locks,
    scriptProps,
    documentProps,
    get userProps() {
      return propsFor(user);
    },
    propsOf: propsFor,
    get user() {
      return user;
    },
    /** Switch to another person who can edit the file (their own user properties and triggers). */
    as(name) {
      user = name;
      return this;
    },
    /** Calls a top-level function of the project. */
    run(name, ...args) {
      const fn = context[name];
      if (typeof fn !== 'function') throw new Error('No function ' + name + ' in ' + project);
      return fn(...args);
    },
    /**
     * A top-level binding of the project by name (SmsTunnel, SmsTunnelKit, SMSTUNNEL_APP...). `const` bindings
     * are not properties of the global object, so they are read in the context; only plain identifiers are taken.
     */
    global(name) {
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('global() takes an identifier, got ' + name);
      return vm.runInContext(name, context);
    },
    /** Sets the key and, for the local API, the server URL, the way Set up stores them. */
    useKey(apiKey, serverUrl) {
      propsFor(user).setProperty('SMSTUNNEL_API_KEY', apiKey);
      if (serverUrl) propsFor(user).setProperty('SMSTUNNEL_SERVER_URL', serverUrl);
    },
    /** Everything the project wrote to logs, sheets, notes, properties and UI, as one string (to look for a key). */
    everything() {
      const parts = logs.map((l) => l.text);
      if (spreadsheet) {
        for (const sheet of spreadsheet.sheets) {
          parts.push(JSON.stringify(sheet.table()));
          sheet.cells.forEach((row) => row.forEach((cell) => cell.note && parts.push(cell.note)));
        }
      }
      parts.push(JSON.stringify(ui.alerts), JSON.stringify(ui.dialogs.map((d) => d.html)));
      return parts.join('\n');
    },
    close() {
      return syncFetch ? syncFetch.close() : undefined;
    },
  };
}

/** A mock SMSTunnel API: answers sends with new message ids and records what was sent. */
export function fakeApi({ phones, failWith } = {}) {
  const sent = [];
  let next = 1;
  const handler = (request) => {
    if (failWith) {
      const out = typeof failWith === 'function' ? failWith(request, sent) : failWith;
      if (out) return out;
    }
    const path = request.url.replace(/^https?:\/\/[^/]+/, '');
    if (request.method === 'POST' && (path === '/api/v1/sms/send' || path === '/api/v1/sms/send-2fa')) {
      const body = JSON.parse(request.payload);
      const id = 'msg' + String(next++).padStart(4, '0');
      sent.push({ ...body, path, id });
      return { status: 200, body: { success: true, messageId: id, data: { messageId: id, branded: false, remaining: { clean: 99, total: 'unlimited' } } } };
    }
    if (request.method === 'GET' && path === '/api/v1/devices') {
      const list = phones || [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'My phone', isOnline: true, lastSeenAt: '2026-11-01T10:00:00.000Z' }];
      return { status: 200, body: { success: true, data: { devices: list, online: list.filter((p) => p.isOnline).length, total: list.length } } };
    }
    if (request.method === 'GET' && path.startsWith('/api/v1/sms/status/')) {
      return { status: 200, body: { success: true, data: { id: decodeURIComponent(path.split('/').pop()), phoneNumber: '+14155550123', status: 'sent', deliveryStatus: 'sent' } } };
    }
    if (request.method === 'GET' && path === '/api/v1/account/usage') {
      return { status: 200, body: { success: true, data: { plan: 'pro', usage: { smsClean: 1 }, limits: { smsClean: 'unlimited' }, remaining: { smsClean: 'unlimited' } } } };
    }
    return { status: 404, body: { message: 'Cannot ' + request.method + ' ' + path, error: 'Not Found', statusCode: 404 } };
  };
  handler.sent = sent;
  return handler;
}
