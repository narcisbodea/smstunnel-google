/**
 * SMSTunnel for Google Apps Script 1.0.0 · https://smstunnel.io
 *
 * Sends texts from your Google Sheets, Forms and Calendar scripts through your own Android phone, from your own
 * number. One number per text: to text several people, call sendSms once for each of them.
 *
 *   SmsTunnel.sendSms('+14155550123', 'Your order has shipped.');
 *
 * Use it as a library (Libraries → + → the SMSTunnel script ID, identifier "SmsTunnel") or paste this file into
 * your project. Both ways, you call SmsTunnel.sendSms(...).
 *
 * The API key comes from options.apiKey, else from your project's user properties (only you can read them),
 * else from its script properties. Save it once with SmsTunnel.setApiKey('sk_live_...') or with Set up in the
 * SMSTunnel menu. Never put it in a cell or in your code.
 *
 * Every call throws an Error named "SmsTunnelError" when a text can't be handed to SMSTunnel. It carries:
 *   status      the HTTP status, or 0 when no answer came back or the call was refused before it was made
 *   code        SMSTunnel's own code when it sends one (such as PERMISSION_REQUIRED), else one of:
 *               INVALID_ARGUMENT, INVALID_NUMBER, MESSAGE_TOO_LONG, NO_CODE, NO_API_KEY (refused here, nothing
 *               sent), NETWORK_ERROR, REDIRECT, INVALID_RESPONSE, BAD_REQUEST (400), UNAUTHORIZED (401),
 *               FORBIDDEN (403), NOT_FOUND (404), RATE_LIMITED (429), SERVER_ERROR (5xx), HTTP_ERROR (others)
 *   retryable   true for 429, 5xx and network errors: trying again a little later may work
 *   retryAfter  seconds to wait, when SMSTunnel says so (429)
 *   permission  with PERMISSION_REQUIRED: the permission the key lacks
 *
 * MIT License · Copyright (c) 2026 NARBOWEB SRL · Narcis Bodea <contact@narboweb.ro>
 */
const SmsTunnel = (function () {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_SERVER_URL = 'https://smstunnel.io';
  var KEY_PROPERTY = 'SMSTUNNEL_API_KEY';
  var SERVER_URL_PROPERTY = 'SMSTUNNEL_SERVER_URL';
  /** SMSTunnel takes up to 1600 characters (10 joined SMS) for a text, 320 for a sign-in code. */
  var MAX_TEXT_LENGTH = 1600;
  var MAX_CODE_TEXT_LENGTH = 320;
  var OPTION_NAMES = ['apiKey', 'deviceId', 'defaultCountryCode', 'serverUrl'];
  var STATUS_CODES = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED' };
  /** What SMSTunnel accepts as a number before it reads it: 7 to 25 digits, spaces, dots, dashes, brackets, +. */
  var NUMBER_SHAPE = /^[\d\s.\-()+]{7,25}$/;
  /** Satellite networks SMSTunnel refuses (the same list as the server). */
  var BLOCKED_PREFIXES = ['+8816', '+8817', '+88216', '+88217', '+870', '+871', '+872', '+873', '+874', '+881', '+882'];

  // ─── Texts ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Sends one text to one number, from your own phone.
   *
   * @param {string} to the number in international format, like +14155550123 (a local number works with
   *     options.defaultCountryCode)
   * @param {string} message the text, up to 1600 characters
   * @param {Object=} options deviceId (send through this phone of yours), defaultCountryCode (like "+1": completes
   *     numbers written without + or 00), serverUrl, apiKey
   * @return {{success: boolean, messageId: string, queued: boolean, branded: boolean, remaining: Object}}
   *     queued is true when your phone was offline: the text waits and goes out when the phone is back online.
   */
  function sendSms(to, message, options) {
    var opts = readOptions(options);
    var body = sendBody(to, message, opts, MAX_TEXT_LENGTH);
    return sendResult(call('post', '/api/v1/sms/send', body, opts));
  }

  /**
   * Sends a sign-in or verification code. The text must contain the code as a number of its own, 4 to 10 digits
   * (like 123456) or 123-456; otherwise nothing is sent (code NO_CODE). It counts against the separate allowance
   * for codes, so use it for sign-in codes only. At most 320 characters.
   *
   * @param {string} to the number, like +14155550123
   * @param {string} message the text with the code, like "Your code is 482913"
   * @param {Object=} options deviceId, defaultCountryCode, serverUrl, apiKey
   * @return {{success: boolean, messageId: string, queued: boolean, branded: boolean, remaining: Object}}
   */
  function sendCode(to, message, options) {
    var opts = readOptions(options);
    var body = sendBody(to, message, opts, MAX_CODE_TEXT_LENGTH);
    if (!containsCode(body.message)) {
      throw fail(
        'No valid verification code found. Put the code in the text as a number of its own, 4 to 10 digits ' +
          '(like 123456 or 123-456). Texts without a code go through sendSms.',
        'NO_CODE'
      );
    }
    return sendResult(call('post', '/api/v1/sms/send-2fa', body, opts));
  }

  /**
   * Where a text is now: pending, sent, delivered or failed. Needs a key that can look up texts (sms:read).
   *
   * @param {string} messageId the messageId sendSms returned
   * @param {Object=} options serverUrl, apiKey
   * @return {{id: string, phoneNumber: string, status: string, deliveryStatus: string, sentAt: string,
   *     deliveredAt: string, errorMessage: string}}
   */
  function getStatus(messageId, options) {
    var opts = readOptions(options);
    var id = typeof messageId === 'string' ? messageId.trim() : '';
    if (!id) throw fail('The message id is empty.', 'INVALID_ARGUMENT');
    var data = call('get', '/api/v1/sms/status/' + encodeURIComponent(id), undefined, opts);
    return data.data && typeof data.data === 'object' ? data.data : data;
  }

  /**
   * The phones linked to your SMSTunnel account. Their id is what options.deviceId takes.
   *
   * @param {Object=} options serverUrl, apiKey
   * @return {Array<{id: string, name: string, isOnline: boolean, lastSeenAt: string}>}
   */
  function getPhones(options) {
    var data = call('get', '/api/v1/devices', undefined, readOptions(options));
    var list = data.data && Array.isArray(data.data.devices) ? data.data.devices : [];
    return list.map(function (phone) {
      return {
        id: String(phone.id),
        name: typeof phone.name === 'string' ? phone.name : '',
        isOnline: phone.isOnline === true,
        lastSeenAt: phone.lastSeenAt || null,
      };
    });
  }

  /**
   * Today's usage, your plan's limits and what is left.
   *
   * @param {Object=} options serverUrl, apiKey
   * @return {Object} plan, usage, limits, remaining
   */
  function getUsage(options) {
    var data = call('get', '/api/v1/account/usage', undefined, readOptions(options));
    return data.data && typeof data.data === 'object' ? data.data : data;
  }

  // ─── The key ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Saves your SMSTunnel API key in this project's user properties, which only you can read. With
   * where = 'script' it goes to the script properties instead, which everyone who can edit the project can read.
   *
   * @param {string} apiKey the key from your SMSTunnel dashboard (Apps → Add an app)
   * @param {string=} where 'user' (default) or 'script'
   */
  function setApiKey(apiKey, where) {
    var key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) throw fail('The key is empty.', 'INVALID_ARGUMENT');
    if (!isPlausibleKey(key)) throw fail(BAD_KEY_WORDS, 'INVALID_ARGUMENT');
    storeFor(where).setProperty(KEY_PROPERTY, key);
  }

  /** Removes the saved key ('user', the default, or 'script'). */
  function clearApiKey(where) {
    storeFor(where).deleteProperty(KEY_PROPERTY);
  }

  /** True when a key is saved in the user or script properties. */
  function hasApiKey() {
    return readProperty(KEY_PROPERTY) !== '';
  }

  /** The last 4 characters of the saved key, like "…a1b2", to tell keys apart without showing them. */
  function apiKeyHint() {
    var key = readProperty(KEY_PROPERTY);
    return key ? '…' + key.slice(-4) : '';
  }

  var BAD_KEY_WORDS =
    'The SMSTunnel API key looks wrong (it has spaces or unusual characters). Copy it again from Apps in your SMSTunnel dashboard.';

  function isPlausibleKey(key) {
    return /^[\x21-\x7E]{8,200}$/.test(key);
  }

  function storeFor(where) {
    if (where === undefined || where === null || where === 'user') return PropertiesService.getUserProperties();
    if (where === 'script') return PropertiesService.getScriptProperties();
    throw fail('where must be "user" or "script".', 'INVALID_ARGUMENT');
  }

  function readProperty(name) {
    var user = PropertiesService.getUserProperties().getProperty(name);
    if (user) return user;
    var script = PropertiesService.getScriptProperties().getProperty(name);
    return script || '';
  }

  // ─── Numbers and codes, checked the way SMSTunnel checks them ───────────────────────────────────────────

  /**
   * A country calling code as "+<digits>": "+49", "49", "0049" and " +1 " give "+49"/"+1". Anything else
   * (letters such as "RO", a leading 0, more than 4 digits) gives null.
   */
  function cleanCountryCode(value) {
    if (typeof value === 'number' && isFinite(value)) value = String(value);
    if (typeof value !== 'string') return null;
    var code = value.replace(/[\s\-().]/g, '');
    if (code.indexOf('00') === 0) code = '+' + code.slice(2);
    else if (code.charAt(0) !== '+') code = '+' + code;
    return /^\+[1-9]\d{0,3}$/.test(code) ? code : null;
  }

  /**
   * Reads a phone number the way SMSTunnel does and gives the exact number the text would go to.
   * A number written without + or 00 needs defaultCountryCode; without one it is refused here (NO_COUNTRY_CODE),
   * so a text never goes to a number in the wrong country.
   *
   * @param {string|number} value the number as written, like "+1 (415) 555-0123", "0722 123 456" or 4155550123
   * @param {string=} defaultCountryCode like "+1" or "40"
   * @return {{ok: boolean, number: string, reason: string, message: string}} number in E.164 when ok
   */
  function normalizePhone(value, defaultCountryCode) {
    var raw = typeof value === 'number' && isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (!raw) return badNumber('EMPTY', 'There is no phone number.');
    if (/[,;\r\n]/.test(raw)) return badNumber('SEVERAL', 'Only one number per text: "' + raw + '" looks like several.');
    if (!NUMBER_SHAPE.test(raw)) {
      return badNumber('NOT_A_NUMBER', '"' + raw + '" is not a phone number. Write it like +14155550123.');
    }
    var number = raw.replace(/[\s.\-()]/g, '');
    if (number.indexOf('00') === 0) {
      number = '+' + number.slice(2);
    } else if (number.charAt(0) !== '+') {
      var cc = cleanCountryCode(defaultCountryCode || '');
      if (!cc) {
        return badNumber(
          'NO_COUNTRY_CODE',
          '"' + raw + '" has no country code. Write it with one, like +14155550123, or set the country code in Set up.'
        );
      }
      number = cc + (number.charAt(0) === '0' ? number.slice(1) : number);
    }
    if (!/^\+[0-9]{7,15}$/.test(number)) {
      return badNumber('NOT_A_NUMBER', '"' + raw + '" is not a phone number (' + number + ' has too few or too many digits).');
    }
    for (var i = 0; i < BLOCKED_PREFIXES.length; i++) {
      if (number.indexOf(BLOCKED_PREFIXES[i]) === 0) return badNumber('BLOCKED', number + ' is a satellite number; SMSTunnel does not text those.');
    }
    if (isShortOrPremium(number)) {
      return badNumber('BLOCKED', number + ' is a short or premium-rate number; SMSTunnel does not text those.');
    }
    return { ok: true, number: number, reason: '', message: '' };
  }

  function badNumber(reason, message) {
    return { ok: false, number: '', reason: reason, message: message };
  }

  function isShortOrPremium(number) {
    var digits = number.replace(/^\+\d{1,3}/, '');
    if (!digits) return false;
    if (digits.length < 7) return true;
    if (/^(17|18|19)\d{2,4}$/.test(digits)) return true;
    return /^0?90[0-9]/.test(digits);
  }

  /**
   * True when a text carries a sign-in code the way SMSTunnel wants one for sendCode: 4 to 10 digits standing on
   * their own ("123456", "Code:1234", "G-123456", "12-345678") or 123-456. Words, letter or mixed codes
   * ("A1B2C3"), 11+ digits, digits right after "+" and dates, times or decimals ("01/11/2026", "3.14") don't count.
   */
  function containsCode(text) {
    if (typeof text !== 'string') return false;
    var runs = digitRuns(text);
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      var length = run.end - run.start;
      if (length >= 4 && length <= 10 && freeBefore(text, run.start, false) && freeAfter(text, run.end, false)) return true;
      var next = runs[i + 1];
      if (
        length === 3 &&
        next &&
        next.start === run.end + 1 &&
        text.charAt(run.end) === '-' &&
        next.end - next.start === 3 &&
        freeBefore(text, run.start, true) &&
        freeAfter(text, next.end, true)
      ) {
        return true;
      }
    }
    return false;
  }

  function digitRuns(text) {
    var runs = [];
    var pattern = /[0-9]+/g;
    var match;
    while ((match = pattern.exec(text)) !== null) runs.push({ start: match.index, end: match.index + match[0].length });
    return runs;
  }

  function isWordChar(ch) {
    return ch !== '' && /[A-Za-z0-9_]/.test(ch);
  }

  function isDigit(ch) {
    return ch !== '' && ch >= '0' && ch <= '9';
  }

  function isGlue(ch) {
    return ch === '.' || ch === ',' || ch === ':' || ch === '/';
  }

  // Nothing right before the code makes it part of something else: a letter or digit, a "+" (a phone number),
  // a "-" for the 123-456 form, or a digit and then . , : or / (a price, a time, a date).
  function freeBefore(text, at, dashCounts) {
    var prev = at > 0 ? text.charAt(at - 1) : '';
    if (prev === '') return true;
    if (isWordChar(prev) || prev === '+') return false;
    if (dashCounts && prev === '-') return false;
    return !(isGlue(prev) && at > 1 && isDigit(text.charAt(at - 2)));
  }

  function freeAfter(text, at, dashCounts) {
    var next = text.charAt(at);
    if (next === '') return true;
    if (isWordChar(next)) return false;
    var after = text.charAt(at + 1);
    if (dashCounts && next === '-' && isDigit(after)) return false;
    return !(isGlue(next) && isDigit(after));
  }

  /**
   * How long SMSTunnel counts a text: an emoji made of two UTF-16 units counts once, and so does a character
   * followed by a variation selector.
   */
  function textLength(text) {
    var value = String(text);
    var pairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g);
    var selectors = value.match(/[^️︎][️︎]/g);
    return value.length - (pairs ? pairs.length : 0) - (selectors ? selectors.length : 0);
  }

  /** True when trying again a little later may work (429, 5xx, network). */
  function isRetryable(error) {
    return !!(error && error.retryable === true);
  }

  // ─── Requests ───────────────────────────────────────────────────────────────────────────────────────────

  function readOptions(options) {
    if (options === undefined || options === null) return {};
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw fail('options must be an object, like { deviceId: "..." }.', 'INVALID_ARGUMENT');
    }
    var out = {};
    Object.keys(options).forEach(function (name) {
      if (OPTION_NAMES.indexOf(name) < 0) {
        throw fail('Unknown option "' + name + '". Use: ' + OPTION_NAMES.join(', ') + '.', 'INVALID_ARGUMENT');
      }
      var value = options[name];
      if (value === undefined || value === null || value === '') return;
      if (typeof value !== 'string') throw fail('Option ' + name + ' must be text.', 'INVALID_ARGUMENT');
      if (value.trim()) out[name] = value.trim();
    });
    if (out.defaultCountryCode) {
      var cc = cleanCountryCode(out.defaultCountryCode);
      if (!cc) {
        throw fail('defaultCountryCode "' + out.defaultCountryCode + '" is not a country code. Write it like +1 or +40.', 'INVALID_ARGUMENT');
      }
      out.defaultCountryCode = cc;
    }
    if (out.deviceId && !/^[A-Za-z0-9_-]{1,64}$/.test(out.deviceId)) {
      throw fail('deviceId "' + out.deviceId + '" is not a phone id. Copy it from Phones in your SMSTunnel dashboard.', 'INVALID_ARGUMENT');
    }
    return out;
  }

  function sendBody(to, message, opts, maxLength) {
    var body = { to: recipient(to), message: textOf(message, maxLength) };
    if (opts.deviceId) body.deviceId = opts.deviceId;
    if (opts.defaultCountryCode) body.defaultCountryCode = opts.defaultCountryCode;
    return body;
  }

  function recipient(to) {
    if (Array.isArray(to)) {
      throw fail('One number per text: call sendSms once for each number.', 'INVALID_NUMBER');
    }
    var value = typeof to === 'number' && isFinite(to) ? String(to) : typeof to === 'string' ? to.trim() : '';
    if (!value) throw fail('The number is empty.', 'INVALID_NUMBER');
    if (/[,;\r\n]/.test(value)) throw fail('Only one number per text: "' + value + '" looks like several.', 'INVALID_NUMBER');
    if (!NUMBER_SHAPE.test(value)) {
      throw fail('"' + value + '" is not a phone number. Write it in international format, like +14155550123.', 'INVALID_NUMBER');
    }
    return value;
  }

  function textOf(message, maxLength) {
    var text = typeof message === 'string' ? message : typeof message === 'number' ? String(message) : '';
    if (!text.trim()) throw fail('The text is empty.', 'INVALID_ARGUMENT');
    var length = textLength(text);
    if (length > maxLength) {
      throw fail(
        'The text has ' + length + ' characters; SMSTunnel takes at most ' + maxLength + (maxLength === MAX_CODE_TEXT_LENGTH ? ' for a code.' : '.'),
        'MESSAGE_TOO_LONG'
      );
    }
    return text;
  }

  function apiKeyFor(opts) {
    var key = opts.apiKey || readProperty(KEY_PROPERTY);
    if (!key) {
      throw fail(
        'No API key yet. Open the SMSTunnel menu → Set up, or run SmsTunnel.setApiKey("...") once. ' +
          'You get a key in your SMSTunnel dashboard: Apps → Add an app.',
        'NO_API_KEY'
      );
    }
    if (!isPlausibleKey(key)) throw fail(BAD_KEY_WORDS, 'INVALID_ARGUMENT');
    return key;
  }

  function serverUrlFor(opts) {
    var url = String(opts.serverUrl || readProperty(SERVER_URL_PROPERTY) || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
    var https = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s?#]*)?$/;
    var local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/[^\s?#]*)?$/;
    if (!https.test(url) && !local.test(url)) {
      throw fail('The SMSTunnel server URL must start with https:// (got "' + url + '").', 'INVALID_ARGUMENT');
    }
    return url;
  }

  function call(method, path, body, opts) {
    var apiKey = apiKeyFor(opts);
    var base = serverUrlFor(opts);
    var params = {
      method: method,
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      muteHttpExceptions: true,
      followRedirects: false,
    };
    if (body !== undefined) {
      params.contentType = 'application/json';
      params.payload = JSON.stringify(body);
    }

    var response;
    try {
      response = UrlFetchApp.fetch(base + path, params);
    } catch (e) {
      var reason = String((e && e.message) || e).split(apiKey).join('[key]');
      throw fail('Could not reach SMSTunnel at ' + base + ': ' + reason, 'NETWORK_ERROR', { retryable: true });
    }

    var status = response.getResponseCode();
    var headers = lowerCaseKeys(response.getHeaders());
    var data = parseBody(response.getContentText());
    if (status >= 300 && status < 400) {
      throw fail(
        headers.location
          ? 'SMSTunnel answered with a redirect to ' + headers.location + '. Set the server URL to that address.'
          : 'SMSTunnel answered with a redirect (' + status + ').',
        'REDIRECT',
        { status: status }
      );
    }
    if (status < 200 || status >= 300) throw fromResponse(status, data, headers);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw fail('SMSTunnel answered with something that is not JSON.', 'INVALID_RESPONSE', { status: status, body: data });
    }
    if (data.success === false) throw fromResponse(status, data, headers);
    return data;
  }

  function sendResult(data) {
    var inner = data.data && typeof data.data === 'object' ? data.data : {};
    var id = data.messageId || inner.messageId;
    if (!id) throw fail('SMSTunnel answered without a message id.', 'INVALID_RESPONSE', { status: 200, body: data });
    return {
      success: true,
      messageId: String(id),
      queued: data.queued === true || inner.queued === true,
      branded: inner.branded === true,
      remaining: inner.remaining || null,
    };
  }

  function parseBody(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }

  function lowerCaseKeys(headers) {
    var out = {};
    if (!headers || typeof headers !== 'object') return out;
    Object.keys(headers).forEach(function (name) {
      out[name.toLowerCase()] = headers[name];
    });
    return out;
  }

  function fromResponse(status, body, headers) {
    var fields = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    var own = typeof fields.code === 'string' && fields.code ? fields.code : '';
    var code = own || STATUS_CODES[status] || (status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR');
    var extra = { status: status, retryable: status === 429 || status >= 500, body: body };
    if (typeof fields.permission === 'string') extra.permission = fields.permission;
    var wait = retryAfterSeconds(headers && headers['retry-after']);
    if (wait !== null) extra.retryAfter = wait;
    return fail(errorMessageOf(body, status), code, extra);
  }

  function retryAfterSeconds(value) {
    if (value === undefined || value === null) return null;
    var text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text);
    var when = Date.parse(text);
    return isNaN(when) ? null : Math.max(0, Math.round((when - Date.now()) / 1000));
  }

  /** The words of an error body, whatever its shape (the same rules as the SMSTunnel SDKs). */
  function errorMessageOf(body, status) {
    if (typeof body === 'string' && body.trim()) {
      var plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain) return plain.slice(0, 300);
    }
    var fields = body && typeof body === 'object' ? body : {};
    var message = Array.isArray(fields.message) ? fields.message.join('; ') : fields.message;
    if (typeof message === 'string' && message) return message;
    if (typeof fields.error === 'string' && fields.error) return fields.error;
    return 'request failed with status ' + status;
  }

  function fail(message, code, extra) {
    var error = new Error('SMSTunnel: ' + message);
    error.name = 'SmsTunnelError';
    error.code = code;
    error.status = 0;
    error.retryable = false;
    if (extra) {
      Object.keys(extra).forEach(function (name) {
        error[name] = extra[name];
      });
    }
    return error;
  }

  return Object.freeze({
    VERSION: VERSION,
    sendSms: sendSms,
    sendCode: sendCode,
    getStatus: getStatus,
    getPhones: getPhones,
    getUsage: getUsage,
    setApiKey: setApiKey,
    clearApiKey: clearApiKey,
    hasApiKey: hasApiKey,
    apiKeyHint: apiKeyHint,
    cleanCountryCode: cleanCountryCode,
    normalizePhone: normalizePhone,
    containsCode: containsCode,
    textLength: textLength,
    isRetryable: isRetryable,
  });
})();
