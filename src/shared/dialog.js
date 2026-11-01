/* The parts every SMSTunnel setup dialog shares. This runs in your browser, inside the dialog. */
var Dialog = (function () {
  'use strict';

  var ANY_PHONE = 'Any of my phones (the one that is online)';
  var PLACEHOLDER = /\{\{\s*([^{}\r\n]{1,80}?)\s*\}\}|\{\s*([^{}\r\n]{1,80}?)\s*\}/g;
  var GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

  function byId(id) {
    return document.getElementById(id);
  }

  /** Calls a function of the script and resolves with its answer. */
  function callServer(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      runner[name].apply(runner, args);
    });
  }

  function errorText(err) {
    var text = err && err.message ? err.message : String(err);
    return text.replace(/^(Exception|Error|ScriptError):\s*/, '');
  }

  function say(text, kind) {
    var box = byId('message');
    box.textContent = text || '';
    box.className = 'notice' + (kind ? ' ' + kind : '');
    if (text) box.scrollIntoView({ block: 'nearest' });
  }

  function clearErrors() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-error-for]'), function (el) {
      el.textContent = '';
    });
  }

  /** Shows each error under its field; true when there was one. */
  function showErrors(errors) {
    clearErrors();
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var el = document.querySelector('[data-error-for="' + name + '"]');
      if (!el) return;
      el.textContent = errors[name];
      if (!first) first = el;
    });
    if (first) first.scrollIntoView({ block: 'center' });
    return first !== null;
  }

  function busy(on) {
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (button) {
      button.disabled = on;
    });
  }

  function option(value, label) {
    var el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    return el;
  }

  /** Fills a select with {value, label} items; keeps `selected` even when the list doesn't have it yet. */
  function fillSelect(select, items, selected, emptyLabel) {
    while (select.firstChild) select.removeChild(select.firstChild);
    if (emptyLabel !== undefined) select.appendChild(option('', emptyLabel));
    var found = false;
    items.forEach(function (item) {
      select.appendChild(option(item.value, item.label));
      if (String(item.value) === String(selected || '')) found = true;
    });
    if (selected && !found) select.appendChild(option(selected, 'The one saved before (' + selected + ')'));
    select.value = selected || '';
  }

  function val(id) {
    var el = byId(id);
    return el ? el.value : '';
  }

  function checked(id) {
    var el = byId(id);
    return !!(el && el.checked);
  }

  function set(id, value) {
    var el = byId(id);
    if (el) el.value = value === undefined || value === null ? '' : value;
  }

  function check(id, on) {
    var el = byId(id);
    if (el) el.checked = !!on;
  }

  function show(id, on) {
    var el = byId(id);
    if (el) el.hidden = !on;
  }

  /** Buttons that put {Name} into a text box where the cursor is. */
  function chips(container, names, textarea, onChange) {
    while (container.firstChild) container.removeChild(container.firstChild);
    names.forEach(function (name) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = '{' + name + '}';
      button.addEventListener('click', function () {
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var text = '{' + name + '}';
        textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
        if (onChange) onChange();
      });
      container.appendChild(button);
    });
  }

  function nameKey(name) {
    return String(name).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** The same filling the script does, for the previews. */
  function fill(template, values) {
    return String(template || '').replace(PLACEHOLDER, function (match, a, b) {
      var key = nameKey(a || b);
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    });
  }

  /** "92 characters · 1 text message", the way phones split long texts. */
  function sizeOf(text) {
    var chars = Array.from(text).length;
    if (!chars) return '';
    var plain = GSM.test(text);
    var parts = plain ? (chars <= 160 ? 1 : Math.ceil(chars / 153)) : chars <= 70 ? 1 : Math.ceil(chars / 67);
    return chars + ' characters · ' + parts + (parts === 1 ? ' text message' : ' text messages (joined on the phone)');
  }

  function preview(el, text) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(text || '(empty)'));
    var count = document.createElement('span');
    count.className = 'count';
    count.textContent = sizeOf(text || '');
    el.appendChild(count);
  }

  /** The key box, its Check button, "Forget my key" and the list of phones, the same in every dialog. */
  function keyField(state, deviceId) {
    var input = byId('apiKey');
    var status = byId('keyState');
    var select = byId('deviceId');
    var forget = byId('forgetKey');
    var saved = state || { saved: false, hint: '' };

    function describe() {
      status.className = 'hint';
      status.textContent = saved.saved
        ? 'A key is saved (' + saved.hint + '). Leave the box empty to keep it.'
        : 'No key saved yet. Get one in your SMSTunnel dashboard: Apps → Add an app.';
      if (forget) forget.hidden = !saved.saved;
    }

    function load(key) {
      status.className = 'hint';
      status.textContent = 'Checking the key…';
      return callServer('smstunnelCheckKey', key)
        .then(function (res) {
          status.className = res.ok ? 'hint good' : 'hint bad';
          status.textContent = res.ok ? (key ? 'The key works.' : 'The saved key (' + saved.hint + ') works.') : res.message;
          if (res.ok && res.message) status.textContent += ' ' + res.message;
          var phones = (res.phones || []).map(function (phone) {
            return { value: phone.id, label: phone.name + (phone.isOnline ? ' · online' : ' · offline') };
          });
          fillSelect(select, phones, select.value || deviceId, ANY_PHONE);
        })
        .catch(function (err) {
          status.className = 'hint bad';
          status.textContent = errorText(err);
        });
    }

    fillSelect(select, [], deviceId, ANY_PHONE);
    describe();
    byId('checkKey').addEventListener('click', function () {
      load(input.value.trim());
    });
    if (forget) {
      forget.addEventListener('click', function () {
        busy(true);
        callServer('smstunnelForgetKey')
          .then(function (next) {
            saved = next;
            input.value = '';
            describe();
            say('Your key is removed from this script. Texts stop until you paste a key again.', 'good');
          })
          .catch(function (err) {
            say(errorText(err), 'bad');
          })
          .then(function () {
            busy(false);
          });
      });
    }
    if (saved.saved) load('');
  }

  function close() {
    google.script.host.close();
  }

  return {
    byId: byId,
    callServer: callServer,
    errorText: errorText,
    say: say,
    clearErrors: clearErrors,
    showErrors: showErrors,
    busy: busy,
    fillSelect: fillSelect,
    val: val,
    checked: checked,
    set: set,
    check: check,
    show: show,
    chips: chips,
    nameKey: nameKey,
    fill: fill,
    sizeOf: sizeOf,
    preview: preview,
    keyField: keyField,
    close: close,
  };
})();
