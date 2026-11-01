/**
 * The functions your script sees when it adds SMSTunnel as a library with the identifier "SmsTunnel":
 * SmsTunnel.sendSms(...), SmsTunnel.sendCode(...) and so on. Each one hands over to SmsTunnel.js.
 *
 * The library reads the API key from YOUR project's properties (Apps Script shares user and script properties
 * with the script that calls a library), so the library itself never holds anyone's key.
 */

/**
 * Sends one text to one number, from your own phone.
 *
 * @param {string} to the number in international format, like +14155550123
 * @param {string} message the text, up to 1600 characters
 * @param {Object=} options deviceId, defaultCountryCode (like "+1"), serverUrl, apiKey
 * @return {{success: boolean, messageId: string, queued: boolean, branded: boolean, remaining: Object}}
 */
function sendSms(to, message, options) {
  return SmsTunnel.sendSms(to, message, options);
}

/**
 * Sends a sign-in code: the text must contain it as 4 to 10 digits standing on their own, or 123-456.
 *
 * @param {string} to the number, like +14155550123
 * @param {string} message the text with the code, like "Your code is 482913"
 * @param {Object=} options deviceId, defaultCountryCode, serverUrl, apiKey
 * @return {{success: boolean, messageId: string, queued: boolean, branded: boolean, remaining: Object}}
 */
function sendCode(to, message, options) {
  return SmsTunnel.sendCode(to, message, options);
}

/**
 * Where a text is now: pending, sent, delivered or failed.
 *
 * @param {string} messageId the messageId sendSms returned
 * @param {Object=} options serverUrl, apiKey
 * @return {Object} id, phoneNumber, status, deliveryStatus, sentAt, deliveredAt, errorMessage
 */
function getStatus(messageId, options) {
  return SmsTunnel.getStatus(messageId, options);
}

/**
 * The phones linked to your SMSTunnel account, and which are online.
 *
 * @param {Object=} options serverUrl, apiKey
 * @return {Array<{id: string, name: string, isOnline: boolean, lastSeenAt: string}>}
 */
function getPhones(options) {
  return SmsTunnel.getPhones(options);
}

/**
 * Today's usage, your plan's limits and what is left.
 *
 * @param {Object=} options serverUrl, apiKey
 * @return {Object}
 */
function getUsage(options) {
  return SmsTunnel.getUsage(options);
}

/**
 * Saves your API key in your project's user properties (only you can read them), or with where = 'script'
 * in its script properties.
 *
 * @param {string} apiKey the key from your SMSTunnel dashboard (Apps → Add an app)
 * @param {string=} where 'user' (default) or 'script'
 */
function setApiKey(apiKey, where) {
  SmsTunnel.setApiKey(apiKey, where);
}

/**
 * Removes the saved key.
 *
 * @param {string=} where 'user' (default) or 'script'
 */
function clearApiKey(where) {
  SmsTunnel.clearApiKey(where);
}

/**
 * True when a key is saved.
 *
 * @return {boolean}
 */
function hasApiKey() {
  return SmsTunnel.hasApiKey();
}

/**
 * The last 4 characters of the saved key, like "…a1b2".
 *
 * @return {string}
 */
function apiKeyHint() {
  return SmsTunnel.apiKeyHint();
}

/**
 * Reads a phone number the way SMSTunnel does.
 *
 * @param {string|number} value the number as written
 * @param {string=} defaultCountryCode like "+1", for numbers written without + or 00
 * @return {{ok: boolean, number: string, reason: string, message: string}}
 */
function normalizePhone(value, defaultCountryCode) {
  return SmsTunnel.normalizePhone(value, defaultCountryCode);
}

/**
 * A country code as "+<digits>", or null.
 *
 * @param {string} value like "40", "+49" or "0049"
 * @return {string}
 */
function cleanCountryCode(value) {
  return SmsTunnel.cleanCountryCode(value);
}

/**
 * True when the text carries a sign-in code that sendCode accepts.
 *
 * @param {string} text
 * @return {boolean}
 */
function containsCode(text) {
  return SmsTunnel.containsCode(text);
}

/**
 * True when trying again a little later may work (429, 5xx, network errors).
 *
 * @param {Error} error an error thrown by this library
 * @return {boolean}
 */
function isRetryable(error) {
  return SmsTunnel.isRetryable(error);
}

/**
 * This library's version.
 *
 * @return {string}
 */
function version() {
  return SmsTunnel.VERSION;
}
