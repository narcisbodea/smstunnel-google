/**
 * SMSTunnel for Google Forms · https://smstunnel.io
 *
 * For each response to this form: a text to you, at one or more of your own numbers (one text each), and, if you
 * want, a confirmation text to the person who answered, at the number they typed in a question you choose.
 * Every text goes out from your own Android phone, from your own number, one number per text.
 *
 * Open the form's editor → SMSTunnel menu → Set up.
 *
 * MIT License · Copyright (c) 2026 NARBOWEB SRL
 */
var SMSTUNNEL_APP = {
  name: 'SMSTunnel for Google Forms',
  short: 'Forms',
  host: 'forms',
  handlers: ['smstunnelOnFormSubmit'],
};

var SMSTUNNEL_FORMS = {
  maxOwnerNumbers: 5,
  maxAnswerLength: 200,
  ownerMessage: 'New response to {Form}:\n{Answers}',
  confirmMessage: 'Thanks! We got your answers to "{Form}".',
  special: ['Form', 'Answers', 'Time', 'Email'],
  questionTypes: [
    'TEXT', 'PARAGRAPH_TEXT', 'MULTIPLE_CHOICE', 'CHECKBOX', 'LIST', 'SCALE', 'RATING', 'GRID', 'CHECKBOX_GRID',
    'DATE', 'TIME', 'DATETIME', 'DURATION', 'FILE_UPLOAD',
  ],
};

function onOpen() {
  FormApp.getUi()
    .createMenu('SMSTunnel')
    .addItem('Set up', 'smstunnelSetUp')
    .addItem('Send a test text', 'smstunnelSendTestText')
    .addItem('Recent texts', 'smstunnelRecentTexts')
    .addSeparator()
    .addItem('Turn texts off', 'smstunnelTurnOff')
    .addItem('Help', 'smstunnelHelp')
    .addToUi();
}

function smstunnelSetUp() {
  SmsTunnelKit.requireScopes();
  SmsTunnelKit.showDialog(SMSTUNNEL_APP, 'Setup', 'SMSTunnel: texts for this form', 500, 680);
}

/** For the setup dialog. */
function smstunnelGetSetupData() {
  var form = FormApp.getActiveForm();
  var s = SmsTunnelKit.loadSettings() || {};
  var state = SmsTunnelKit.setupState();
  return {
    key: SmsTunnelKit.keyStatus(),
    setup: state,
    on: state === 'mine' && s.enabled === true && SmsTunnelKit.countTriggers(SMSTUNNEL_APP.handlers) > 0,
    formTitle: form.getTitle(),
    configured: !!s.ownerMessage,
    special: SMSTUNNEL_FORMS.special,
    questions: smstunnelFormQuestions_(form),
    settings: {
      ownerNumbers: (s.ownerNumbers || []).join('\n'),
      ownerMessage: s.ownerMessage || SMSTUNNEL_FORMS.ownerMessage,
      confirm: s.confirm === true,
      phoneQuestionId: s.phoneQuestionId || '',
      consentQuestionId: s.consentQuestionId || '',
      confirmMessage: s.confirmMessage || SMSTUNNEL_FORMS.confirmMessage,
      countryCode: s.countryCode || '',
      deviceId: s.deviceId || '',
      timeZone: s.timeZone || '',
    },
  };
}

/** For the setup dialog: checks a key and lists your phones. */
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
  var form = FormApp.getActiveForm();
  var questions = smstunnelFormQuestions_(form);
  var data = input || {};
  var errors = {};

  var countryCode = '';
  if (String(data.countryCode || '').trim()) {
    countryCode = SmsTunnel.cleanCountryCode(String(data.countryCode)) || '';
    if (!countryCode) errors.countryCode = 'Write a country code like +1 or +40, or leave it empty.';
  }

  var owners = SmsTunnelKit.parseNumbers(data.ownerNumbers, countryCode, SMSTUNNEL_FORMS.maxOwnerNumbers);
  if (owners.problem) errors.ownerNumbers = owners.problem;
  else if (!owners.numbers.length) errors.ownerNumbers = 'Add at least one of your own numbers.';

  var known = SMSTUNNEL_FORMS.special.concat(questions.map(function (q) { return q.title; }));
  var ownerMessage = String(data.ownerMessage || '').trim();
  if (!ownerMessage) errors.ownerMessage = 'Write the text you want to get.';
  else if (SmsTunnel.textLength(ownerMessage) > 1600) errors.ownerMessage = 'The text is too long (at most 1600 characters).';
  else smstunnelCheckPlaceholders_(ownerMessage, known, 'ownerMessage', errors);

  var confirm = data.confirm === true;
  var phoneQuestion = null;
  var consentQuestionId = '';
  var consentChoice = '';
  var confirmMessage = String(data.confirmMessage || '').trim();
  if (confirm) {
    phoneQuestion = smstunnelFindQuestion_(questions, data.phoneQuestionId);
    if (!phoneQuestion) errors.phoneQuestionId = 'Choose the question where people type their phone number.';
    else if (phoneQuestion.type !== 'TEXT') errors.phoneQuestionId = 'Choose a short-answer question (people type their number in it).';
    if (data.consentQuestionId) {
      var consent = smstunnelFindQuestion_(questions, data.consentQuestionId);
      if (!consent) errors.consentQuestionId = 'That question is no longer in the form.';
      else if (consent.type !== 'CHECKBOX' || !consent.choices.length) {
        errors.consentQuestionId = 'Choose a checkbox question, like "Text me a confirmation": its first box is the yes.';
      } else {
        consentQuestionId = String(consent.id);
        consentChoice = consent.choices[0];
      }
    }
    if (!confirmMessage) errors.confirmMessage = 'Write the confirmation text.';
    else if (SmsTunnel.textLength(confirmMessage) > 1600) errors.confirmMessage = 'The text is too long (at most 1600 characters).';
    else smstunnelCheckPlaceholders_(confirmMessage, known, 'confirmMessage', errors);
  }

  var deviceId = String(data.deviceId || '').trim();
  if (deviceId && !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) errors.deviceId = 'Choose a phone from the list.';

  var timeZone = String(data.timeZone || '').trim();
  if (timeZone && !/^(UTC|GMT|Etc\/[A-Za-z0-9+_-]{1,20}|[A-Za-z]{2,20}(\/[A-Za-z0-9_+-]{2,30}){1,2})$/.test(timeZone)) {
    errors.timeZone = 'Write a time zone like Europe/Bucharest or America/New_York.';
  }

  var keyProblem = SmsTunnelKit.keyProblem(data.apiKey);
  if (keyProblem) errors.apiKey = keyProblem;

  if (Object.keys(errors).length) return { ok: false, errors: errors };

  SmsTunnelKit.saveKey(data.apiKey);
  SmsTunnelKit.saveSettings({
    enabled: true,
    ownerNumbers: owners.numbers,
    ownerMessage: ownerMessage,
    confirm: confirm,
    phoneQuestionId: confirm ? String(phoneQuestion.id) : '',
    consentQuestionId: confirm ? consentQuestionId : '',
    consentChoice: confirm ? consentChoice : '',
    confirmMessage: confirmMessage || SMSTUNNEL_FORMS.confirmMessage,
    countryCode: countryCode,
    deviceId: deviceId,
    timeZone: timeZone,
  });
  SmsTunnelKit.removeTriggers(SMSTUNNEL_APP.handlers);
  SmsTunnelKit.claimSetup();
  ScriptApp.newTrigger('smstunnelOnFormSubmit').forForm(form).onFormSubmit().create();
  SmsTunnelKit.clearProblem();

  var who = owners.numbers.length === 1 ? owners.numbers[0] : owners.numbers.length + ' of your numbers';
  return {
    ok: true,
    message:
      'Texts are on. Each new response sends a text to ' + who + '.' +
      (confirm ? ' The person who answered gets a confirmation at the number they typed' + (consentQuestionId ? ', when they tick "' + consentChoice + '".' : '.') : ''),
  };
}

/** The form trigger: runs for each response. */
function smstunnelOnFormSubmit(e) {
  var settings = SmsTunnelKit.beginRun(e, SMSTUNNEL_APP);
  if (!settings) return;
  if (!e || !e.response) {
    console.warn('SMSTunnel for Google Forms: the event carries no response.');
    return;
  }
  var form = e.source || FormApp.getActiveForm();
  var outcome = smstunnelHandleResponse_(form, e.response, settings);
  if (outcome.problem) {
    // Google emails you about a trigger run that fails, so a key that stopped working doesn't go unnoticed.
    throw new Error('SMSTunnel for Google Forms: ' + outcome.problem);
  }
}

function smstunnelSendTestText() {
  var settings = SmsTunnelKit.loadSettings() || {};
  SmsTunnelKit.sendTestText(SMSTUNNEL_APP, (settings.ownerNumbers || [])[0] || '');
}

function smstunnelRecentTexts() {
  var list = SmsTunnelKit.recent();
  var esc = SmsTunnelKit.escapeHtml;
  var rows = list
    .map(function (item) {
      return (
        '<tr><td>' + esc(String(item.at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(item.kind) + '</td><td>' +
        esc(item.to) + '</td><td>' + esc(item.result) + (item.details ? '<div class="muted">' + esc(item.details) + '</div>' : '') + '</td></tr>'
      );
    })
    .join('');
  var html = list.length
    ? '<p class="muted">The last ' + list.length + ' texts (times in UTC).</p><table><tr><th>When</th><th>For</th><th>To</th><th>Result</th></tr>' + rows + '</table>'
    : '<p>No texts yet. They show here after the first response.</p>';
  SmsTunnelKit.showPage(SMSTUNNEL_APP, 'SMSTunnel: recent texts', html, 560, 460);
}

function smstunnelTurnOff() {
  SmsTunnelKit.turnOff(SMSTUNNEL_APP);
  SmsTunnelKit.alert(SMSTUNNEL_APP, 'Texts are off', 'New responses no longer send texts. Your settings and key are kept: Set up turns the texts on again.');
}

function smstunnelHelp() {
  SmsTunnelKit.showHelp(
    SMSTUNNEL_APP,
    '<p>For each response to this form you get a text at your own numbers, one text per number. If you turn it on, the person who answered gets a confirmation at the number they typed.</p>' +
      '<p>Texts go out from your phone right after the response comes in. An edited response sends you a new text marked "Edited"; a confirmation goes out once per response.</p>' +
      '<p class="muted">Times in your texts use the time zone ' + SmsTunnelKit.escapeHtml((SmsTunnelKit.loadSettings() || {}).timeZone || Session.getScriptTimeZone()) + ' (Set up → More settings).</p>'
  );
}

// ─── The work ───────────────────────────────────────────────────────────────────────────────────────────────

function smstunnelHandleResponse_(form, response, settings) {
  var answers = smstunnelAnswers_(response);
  var values = smstunnelValues_(form, response, answers, settings);
  // Only the shared lists are locked, briefly; the texts go out without holding up other responses.
  var edited = SmsTunnelKit.withLock(function () {
    return SmsTunnelKit.seenBefore(response.getId());
  }, 60000);
  if (edited !== true) edited = false;
  var once = 'forms|' + response.getId() + '|' + response.getTimestamp().getTime();
  var outcome = { sent: 0, skipped: 0, problem: '', once: once };

  var ownerText = SmsTunnelKit.fill(settings.ownerMessage || SMSTUNNEL_FORMS.ownerMessage, values).text;
  ownerText = SmsTunnelKit.truncate((edited ? 'Edited: ' : '') + ownerText, 1600);
  var numbers = settings.ownerNumbers || [];
  for (var i = 0; i < numbers.length && !outcome.problem; i++) {
    smstunnelSend_(numbers[i], ownerText, settings, 'you', outcome);
  }

  if (settings.confirm === true && !edited && !outcome.problem) smstunnelConfirm_(answers, values, settings, outcome);
  console.log('SMSTunnel for Google Forms: ' + outcome.sent + ' sent, ' + outcome.skipped + ' skipped.');
  return outcome;
}

function smstunnelConfirm_(answers, values, settings, outcome) {
  var phoneAnswer = smstunnelAnswerFor_(answers, settings.phoneQuestionId);
  if (!phoneAnswer) {
    smstunnelSkip_('', 'No confirmation: the phone question was left empty.', outcome);
    return;
  }
  if (settings.consentQuestionId && !smstunnelConsented_(answers, settings)) {
    smstunnelSkip_('', 'No confirmation: the consent question was not ticked.', outcome);
    return;
  }
  var phone = SmsTunnel.normalizePhone(phoneAnswer, settings.countryCode);
  if (!phone.ok) {
    smstunnelSkip_(phoneAnswer, 'No confirmation: ' + phone.message, outcome);
    return;
  }
  var filled = SmsTunnelKit.fill(settings.confirmMessage || SMSTUNNEL_FORMS.confirmMessage, values);
  if (filled.missing.length) {
    smstunnelSkip_(phone.number, 'No confirmation: the text uses {' + filled.missing.join('}, {') + '}, which this form no longer has.', outcome);
    return;
  }
  smstunnelSend_(phone.number, SmsTunnelKit.truncate(filled.text, 1600), settings, 'confirmation', outcome);
}

function smstunnelSend_(number, text, settings, kind, outcome) {
  var once = outcome.once + '|' + kind;
  var result = SmsTunnelKit.sendOne(number, text, settings, once);
  if (!result.ok && result.kind === 'transient') {
    // A response comes only once, so wait a little and try a second time, with the same key: never two texts.
    Utilities.sleep(Math.min(20, Math.max(3, Number(result.error.retryAfter) || 5)) * 1000);
    result = SmsTunnelKit.sendOne(number, text, settings, once);
  }
  if (result.ok) {
    outcome.sent++;
    smstunnelRemember_({
      at: new Date().toISOString(),
      kind: kind,
      to: number,
      result: result.queued ? 'Waiting for your phone' : 'Sent',
      details: result.queued ? 'Your phone was offline; the text goes out when it is back online.' : '',
    });
    return;
  }
  outcome.skipped++;
  smstunnelRemember_({ at: new Date().toISOString(), kind: kind, to: number, result: 'Not sent', details: result.explain });
  console.warn('SMSTunnel for Google Forms: no text to ' + SmsTunnelKit.mask(number) + ': ' + result.explain);
  if (result.kind === 'account') {
    outcome.problem = result.explain;
    SmsTunnelKit.noteProblem(result.explain);
  }
}

function smstunnelSkip_(to, why, outcome) {
  outcome.skipped++;
  smstunnelRemember_({ at: new Date().toISOString(), kind: 'confirmation', to: String(to || ''), result: 'Not sent', details: why });
}

/** "Recent texts" is shared by every run: it is updated under the form's lock (and skipped if the form stays busy). */
function smstunnelRemember_(entry) {
  SmsTunnelKit.withLock(function () {
    SmsTunnelKit.remember(entry);
  }, 20000);
}

/** True when the consent checkbox's first box (the yes) is ticked. */
function smstunnelConsented_(answers, settings) {
  for (var i = 0; i < answers.length; i++) {
    if (answers[i].id !== String(settings.consentQuestionId)) continue;
    var raw = answers[i].raw;
    var ticked = Array.isArray(raw) ? raw : [raw];
    return ticked.map(String).indexOf(String(settings.consentChoice)) >= 0;
  }
  return false;
}

/** Questions people answer (not section headers, images or videos). */
function smstunnelFormQuestions_(form) {
  return form
    .getItems()
    .filter(function (item) {
      return SMSTUNNEL_FORMS.questionTypes.indexOf(String(item.getType())) >= 0;
    })
    .map(function (item) {
      var type = String(item.getType());
      var choices = [];
      if (type === 'CHECKBOX') {
        choices = item
          .asCheckboxItem()
          .getChoices()
          .map(function (choice) {
            return choice.getValue();
          });
      }
      return { id: String(item.getId()), title: item.getTitle(), type: type, choices: choices };
    });
}

function smstunnelFindQuestion_(questions, id) {
  for (var i = 0; i < questions.length; i++) {
    if (String(questions[i].id) === String(id)) return questions[i];
  }
  return null;
}

function smstunnelCheckPlaceholders_(template, known, field, errors) {
  var unknown = SmsTunnelKit.unknownPlaceholders(template, known);
  if (unknown.length) {
    errors[field] = 'This form has no question called {' + unknown.join('}, {') + '}. Use the buttons below the box to add one.';
  }
}

function smstunnelAnswers_(response) {
  return response.getItemResponses().map(function (itemResponse) {
    var item = itemResponse.getItem();
    var type = String(item.getType());
    var value = itemResponse.getResponse();
    var text;
    if (type === 'FILE_UPLOAD') text = Array.isArray(value) ? value.length + (value.length === 1 ? ' file' : ' files') : '';
    else if (Array.isArray(value)) {
      text = value
        .map(function (part) {
          return Array.isArray(part) ? part.filter(Boolean).join(' / ') : String(part === null || part === undefined ? '' : part);
        })
        .filter(Boolean)
        .join(', ');
    } else text = value === null || value === undefined ? '' : String(value);
    return { id: String(item.getId()), title: item.getTitle(), text: text.trim(), raw: value };
  });
}

function smstunnelAnswerFor_(answers, id) {
  for (var i = 0; i < answers.length; i++) {
    if (answers[i].id === String(id)) return answers[i].text;
  }
  return '';
}

function smstunnelValues_(form, response, answers, settings) {
  var key = SmsTunnelKit.nameKey;
  var values = {};
  var timeZone = (settings && settings.timeZone) || Session.getScriptTimeZone();
  values[key('Form')] = form.getTitle();
  values[key('Time')] = Utilities.formatDate(response.getTimestamp(), timeZone, 'yyyy-MM-dd HH:mm');
  values[key('Email')] = response.getRespondentEmail ? response.getRespondentEmail() || '' : '';
  values[key('Answers')] = answers
    .filter(function (answer) {
      return answer.text;
    })
    .map(function (answer) {
      return answer.title + ': ' + SmsTunnelKit.truncate(answer.text, SMSTUNNEL_FORMS.maxAnswerLength);
    })
    .join('\n');
  // Every question by its title, empty when it was skipped.
  smstunnelFormQuestions_(form).forEach(function (question) {
    values[key(question.title)] = '';
  });
  answers.forEach(function (answer) {
    values[key(answer.title)] = answer.text;
  });
  return values;
}
