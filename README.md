# SMSTunnel for Google Sheets, Forms and Calendar

Text reminders and notices from **Google Calendar**, **Google Sheets** and **Google Forms**, sent by **your own Android phone**, from **your own number**. Your spreadsheet or form hands each text to your [SMSTunnel](https://smstunnel.io) account, and your phone sends it from its own SIM, so people see a number they know and can reply to. There is no server to run: everything is Google Apps Script inside your own spreadsheet or form.

Google Calendar stopped sending text (SMS) notifications on 7 January 2019, leaving app and email notifications only ([Google Workspace Updates](https://workspaceupdates.googleblog.com/2018/11/google-calendar-sms-notifications-to-be-removed.html)). The Calendar template brings text reminders back, from your own phone.

Your phone needs the SMSTunnel app from Google Play:

<a href="https://play.google.com/store/apps/details?id=io.smstunnel.app"><img src="https://smstunnel.io/google-play-badge.png" alt="Get it on Google Play" height="56"></a>

## What's inside

| Template | What it does |
| --- | --- |
| **SMSTunnel for Google Calendar** | A text to you before each event (5 minutes to a day before), your agenda each morning, and reminders to the people in your appointments. |
| **SMSTunnel for Google Forms** | A text to you for each response, and an optional confirmation text to the person who answered. |
| **SMSTunnel for Google Sheets: status texts** | When a row's status becomes the value you choose ("Shipped", "Ready"...), the number in that row gets your text, once. |
| **SMSTunnel for Google Sheets: appointment reminders** | Each appointment in your sheet gets one reminder text a few hours before. |
| **The SMSTunnel library** | `SmsTunnel.sendSms(...)` for your own Apps Script code. |

Each one is a complete Apps Script project in [`apps-script/`](apps-script): `calendar-reminders`, `forms-text-me`, `sheets-status-texts`, `sheets-reminders` and `library`.

Every template sends one text per number, only to the numbers it is set up for, at most a set number of texts per run, and never the same text twice.

## Before you start

1. Install the [SMSTunnel app](https://play.google.com/store/apps/details?id=io.smstunnel.app) on your Android phone and sign in. Sign in at [smstunnel.io](https://smstunnel.io) with the same account: the phone shows under **Phones** (you can also link it with the QR code from **Phones → Add phone**).
2. In your [SMSTunnel dashboard](https://dashboard.smstunnel.io/apps), open **Apps → Add an app** and copy the key. A new key can send texts and look up whether they went out. Make one key per spreadsheet or form, so you can stop one without touching the others.

## Set up a template

### With a template link (the easy way)

| Template | Template link |
| --- | --- |
| SMSTunnel for Google Calendar | added once published (see [PUBLISHING.md](PUBLISHING.md)) |
| SMSTunnel for Google Forms | added once published |
| SMSTunnel for Google Sheets: status texts | added once published |
| SMSTunnel for Google Sheets: appointment reminders | added once published |

1. Open the template link and click **Make a copy**. The copy is yours: its script is yours too, in your own Google account.
2. Open your copy. The **SMSTunnel** menu shows up after a few seconds (reload the page once if it doesn't).
3. Choose **SMSTunnel → Set up**. Google asks you to allow the script the first time (see [Google's permission screen](#googles-permission-screen-explained) below).
4. Paste your key, click **Check**, choose the phone that sends the texts, fill in the rest and click **Save and turn on**.
5. Send yourself a test: **SMSTunnel → Send a test text** (Calendar: **Send me a test reminder**).

### By pasting the code into your own spreadsheet or form

1. Open the Apps Script editor of your file:
   - a spreadsheet: **Extensions → Apps Script**;
   - a form: open the form's editor, then **⋮ (More) → Apps Script**.
2. Make the same files as the template's folder in [`apps-script/`](apps-script) and paste each one's content:
   - `SmsTunnel`, `SmsTunnelKit` and `Code`: script files (**+ → Script**; the editor names them `.gs`);
   - `Setup`: an HTML file (**+ → HTML**).
3. Open **Project Settings** (the gear), tick **Show "appsscript.json" manifest file in editor**, open `appsscript.json` and replace it with the template's.
4. Save, go back to your spreadsheet or form and reload it. Then **SMSTunnel → Set up**, as above.

For a form, the SMSTunnel menu is in the form's editor; people who fill in the form never see it.

## Google's permission screen, explained

The first time you choose **Set up**, Google asks you to allow the script. Because it is your own copy of a script Google hasn't reviewed, Google shows **"Google hasn't verified this app"**. That is expected for a script you own: click **Advanced → Go to … (unsafe)**. You can read every line of it in **Extensions → Apps Script** first. Google may let you tick the permissions one by one: tick all of them, because the texts can't go out without them (Set up asks again if one is missing).

What each permission is for (Google's screen words them its own way):

| Permission | Used for | Templates |
| --- | --- | --- |
| Connect to an external service (`script.external_request`) | Handing each text to SMSTunnel at https://smstunnel.io. Nothing else is called. | all |
| This spreadsheet only (`spreadsheets.currentonly`) | Reading your rows and writing "Texted at", "Reminder sent" and the "SMSTunnel log" sheet. No other spreadsheet. | Sheets, Calendar |
| This form only (`forms.currentonly`) | Reading this form's questions and responses. | Forms |
| See your calendars (`calendar.readonly`) | Reading your events. It never changes or adds an event. | Calendar |
| Show dialogs (`script.container.ui`) | The SMSTunnel menu, the setup dialog and the previews. | all |
| Run when you are not present (`script.scriptapp`) | The triggers that run when a response comes in, a cell changes or the time comes. | all |

You can remove the script's access anytime in your Google Account (**Security → Third-party apps & services**), and stop every text at once by deleting the key under **Apps** in your SMSTunnel dashboard.

## The templates

### SMSTunnel for Google Calendar

The script lives in a spreadsheet, which keeps the log and, if you want, your guests' numbers. Set up has three parts; turn on the ones you want:

- **Remind me before each event**: a text to your own numbers (up to 5, one text each) 5, 10, 15, 30 or 45 minutes, 1 to 12 hours, or a day before each event in the calendars you choose. Optionally only events whose title has a word you choose ("dentist, call"). All-day events are left out unless you include them (they then count as starting at the hour you choose, 8:00 by default).
- **My agenda**: one text each day at the hour you choose: "Today, Mon, Nov 2: 9:00 AM Dentist, 2:00 PM Call with Ana". Days with nothing planned are skipped unless you say otherwise.
- **Reminders to the people in your events**: for appointments. The person's number comes from a line in the event's description that starts with a word you choose and a colon, such as `SMS: +1 415 555 0123` or `Phone: 0722 123 456`, or from the **Phone numbers** sheet (Email, Phone, Name) for guests you invited. Other numbers in a description, such as a video call's dial-in line, are never used. Reminders to people go out only between the hours you choose (8:00 to 21:00 by default), at most 10 people per event.

Texts can use `{Title}`, `{Date}`, `{Time}`, `{Location}`, `{Calendar}`, `{In}` ("in 15 min") and, for people, `{Name}`.

- **Never twice**: each text is recorded (event, start time and number) in a hidden **SMSTunnel sent** sheet. If an event moves, its new time gets one new text. Declined events are left out.
- **How often it checks**: every 5 minutes when you want a reminder 15 minutes or less before, every 10 minutes up to an hour, every 15 minutes otherwise or for the agenda, and every hour when only people get reminders. That stays well within Google's daily limits (below).
- **Menu**: Set up, **Send me a test reminder** (uses your next event, or a made-up one), **Preview the next texts** (what goes out in the next 24 hours, without sending anything), **Send due texts now**, **Turn texts off**, Help. The setup dialog has the same test button, so you can try your text before saving.

### SMSTunnel for Google Forms

- For each response, a text to your own numbers (up to 5, one text each). The default text is `New response to {Form}:` followed by the answers; you can use `{Form}`, `{Answers}`, `{Time}`, `{Email}` and any question's title, like `{Your name}`.
- Optionally, a confirmation text to the person who answered, at the number they typed in a short-answer question you choose. You can also choose a consent question (for example a checkbox "Text me a confirmation"): the confirmation then goes out only when it's ticked. Tell people in the form that you will text them.
- An edited response sends you a new text marked "Edited"; the confirmation goes out once per response.
- **Recent texts** in the menu lists the last 20 texts and why any did not go out.

### SMSTunnel for Google Sheets: status texts

- Choose the sheet, the status column, the value (like `Shipped`) and the phone column, and write the text with the row's columns as placeholders: `Hi {Name}, your order {Order} has shipped.`
- When someone changes a status to that value, the number in that row gets the text, and **Texted at** (a column SMSTunnel adds) shows when. A note on that cell shows the number and the message id. A row is never texted twice; to text it again, clear its "Texted at" cell and set the status again.
- Rows that already have the value when you set it up are marked as skipped, so only changes from now on send texts.
- Pasting the value into many rows sends at most 20 texts at once (you choose the limit, up to 50); the rest wait.
- Edits made by other apps or scripts don't count as edits for Google, so they don't run the edit trigger. Tick **Also check every 15 minutes** to cover those, or use **Send waiting texts now**.

### SMSTunnel for Google Sheets: appointment reminders

- Choose the sheet, the phone column, the date column and, if the time is in its own column, the time column. Dates can be real dates or text like `2026-11-02 14:30`; times like `14:30` or `2:30 PM`. They are read in the spreadsheet's time zone (**File → Settings**).
- Every hour (or once a day at the hour you choose), each row whose appointment is within the next hours you choose (24 by default) gets one reminder, soonest first, and **Reminder sent** records it.
- Texts go out only between the hours you choose (8:00 to 21:00 by default), at most 25 per run (up to 100); the rest go out on the next run.
- Rows without a valid number are marked **Not sent** with the reason. **Preview the next reminders** shows what would go out, without sending anything.

### What all templates share

- **Numbers**: write them in international format, like `+14155550123`. Tip: **Format → Number → Plain text** keeps the `+` in a cell. Numbers without a country code need the country code in Set up; without it they are skipped, so a text never goes to a number in the wrong country.
- **The log**: every text, and every row or event that could not be texted, is listed in the **SMSTunnel log** sheet (the last 2000 lines). The Forms template shows **Recent texts** instead.
- **When something stops the texts** (a deleted key, a phone no longer linked), the run fails on purpose, so Google emails you about it, and **Help** shows the last problem. Short outages and "too many texts" just wait for the next run.
- **Your phone offline**: the text waits and goes out as soon as the phone is back online.
- **One setup per file**: if two editors both run Set up, the latest one sends and the other one's trigger removes itself, so nobody gets a text twice.
- **Turn texts off** removes the triggers; your settings and key stay, so Set up turns them back on.

## Use the library in your own scripts

Add it as a library (**Libraries → +**, the SMSTunnel library's Script ID, identifier `SmsTunnel`; the Script ID is added here once the library is published), or paste [`apps-script/library/SmsTunnel.js`](apps-script/library/SmsTunnel.js) into your project. Both ways, you call `SmsTunnel.sendSms(...)`.

Save the key once, without writing it into your code:

```js
function saveSmsTunnelKey() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('SMSTunnel key', 'Paste the key from Apps → Add an app in your SMSTunnel dashboard.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() === ui.Button.OK) SmsTunnel.setApiKey(answer.getResponseText());
}
```

`setApiKey` keeps it in your project's user properties, which only you can read. The library reads the key from your project (never from the library's own), first `options.apiKey`, then user properties, then script properties.

```js
// Text the number in the row you are on.
function textThisRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow();
  var phone = SmsTunnel.normalizePhone(sheet.getRange(row, 2).getDisplayValue(), '+1');
  if (!phone.ok) throw new Error(phone.message);
  var result = SmsTunnel.sendSms(phone.number, 'Your order is ready for pickup.');
  sheet.getRange(row, 5).setValue(result.queued ? 'Waiting for my phone' : 'Texted');
}
```

| Function | What it does |
| --- | --- |
| `sendSms(to, message, options)` | One text to one number. `options`: `deviceId` (one of your phones), `defaultCountryCode` (like `"+1"`, for numbers without `+` or `00`), `serverUrl`, `apiKey`. Returns `{ messageId, queued, branded, remaining }`; `queued` is true when your phone was offline (the text waits). |
| `sendCode(to, message, options)` | A sign-in code, through the separate allowance for codes. The text must hold a code of 4 to 10 digits standing on its own (`482913`, `12-345678`) or `123-456`, at most 320 characters; otherwise nothing is sent (`NO_CODE`). |
| `getStatus(messageId)` | `pending`, `sent`, `delivered` or `failed`, with times. |
| `getPhones()` | Your phones: `id`, `name`, `isOnline`, `lastSeenAt`. |
| `getUsage()` | Today's usage, your plan's limits and what's left. |
| `setApiKey(key, where)`, `clearApiKey(where)`, `hasApiKey()`, `apiKeyHint()` | The saved key (`where`: `'user'`, the default, or `'script'`). The hint is the last 4 characters. |
| `normalizePhone(value, countryCode)` | The exact number a text would go to (`{ ok, number }`), or why not (`{ ok: false, reason, message }`), read the way SMSTunnel reads numbers. |
| `containsCode(text)`, `cleanCountryCode(value)`, `isRetryable(error)` | The same checks SMSTunnel makes. |

One number per call: to text several people, call `sendSms` once for each of them.

Every function throws an `Error` named `SmsTunnelError` when a text can't be handed over:

| `code` | `status` | `retryable` | Meaning |
| --- | --- | --- | --- |
| `INVALID_NUMBER`, `INVALID_ARGUMENT`, `MESSAGE_TOO_LONG`, `NO_CODE`, `NO_API_KEY` | 0 | no | Refused before anything was sent. |
| `BAD_REQUEST` | 400 | no | SMSTunnel refused a field, such as a number it can't read. |
| `UNAUTHORIZED` | 401 | no | The key is wrong or was deleted. |
| `PERMISSION_REQUIRED` or `FORBIDDEN` | 403 | no | The key lacks a permission (`error.permission` says which), or your plan doesn't include it. |
| `NOT_FOUND` | 404 | no | No such message or phone for this key. |
| `RATE_LIMITED` | 429 | yes | Too many texts in a short time; `error.retryAfter` gives the seconds to wait. |
| `SERVER_ERROR`, `NETWORK_ERROR` | 5xx, 0 | yes | SMSTunnel couldn't be reached; try again a little later. |
| `REDIRECT`, `INVALID_RESPONSE`, `HTTP_ERROR` | other | no | Something between you and SMSTunnel answered instead. |

## Limits

- **SMSTunnel**: 30 send requests a minute; up to 1600 characters per text (joined on the phone), 320 for a code. Your plan's daily allowance applies.
- **Google Apps Script** ([quotas](https://developers.google.com/apps-script/guides/services/quotas)): with a free Google account, 20,000 URL Fetch calls a day (one per text), 90 minutes of trigger run time a day and 6 minutes per run; Google Workspace accounts get 100,000 calls and 6 hours. The templates pause 2 seconds between texts (to stay under SMSTunnel's 30 a minute) and cap each run, so even a run at the highest cap (100 texts) ends within Google's 6 minutes.

## Left out on purpose

- **No button that texts everyone.** Every template texts only the numbers it was set up for (your own numbers, the row whose status changed, the appointment that is coming up, the person in an event), one text per number, with a cap per run.
- **No reading of received texts.** The templates only send.
- **No confirmation without a phone question you choose** in the Forms template, and an optional consent question on top.
- **No numbers guessed from an event's description**: only lines that start with your chosen word and a colon.

## Build it with an AI assistant

Want something the templates don't do? Copy this prompt into Claude, ChatGPT, Cursor or Copilot, and replace the part in brackets. Never paste your real key into a prompt.

```text
Help me write Google Apps Script code (V8 runtime) that sends text messages with SMSTunnel.

SMSTunnel sends texts through my own Android phone, from my own number: my script hands each text to my
SMSTunnel account and the SMSTunnel app on my phone sends it from its SIM.

Install: paste the file SmsTunnel.js (from "SMSTunnel for Google Sheets, Forms and Calendar",
apps-script/library/SmsTunnel.js) into my Apps Script project, or add the SMSTunnel library with the
identifier SmsTunnel. Then call SmsTunnel.sendSms(to, message, options).

API facts:
- SmsTunnel.sendSms(to, message, { deviceId, defaultCountryCode }) makes one call to
  POST https://smstunnel.io/api/v1/sms/send with the header X-API-Key: <key> and the JSON body
  { "to": "+14155550123", "message": "...", "deviceId": "...", "defaultCountryCode": "+1" }
  (deviceId and defaultCountryCode are optional). It returns { messageId, queued }.
- One recipient per call: to text several people, call it once per person.
- Numbers in international format (+14155550123). defaultCountryCode ("+1", "40") completes numbers written
  without + or 00, and wins over the phone's own country. SmsTunnel.normalizePhone(value, countryCode) gives the
  exact number or the reason it is refused.
- Texts: up to 1600 characters. Sending is limited to 30 requests a minute.
- Sign-in codes: SmsTunnel.sendCode(to, message) calls POST /api/v1/sms/send-2fa; the text must contain a code
  of 4 to 10 digits standing on its own (or 123-456), at most 320 characters, or it is refused (400).
- Errors throw an Error named SmsTunnelError with status, code and retryable: 401 = wrong or deleted key,
  403 = the key lacks a permission (code PERMISSION_REQUIRED) or the plan doesn't allow it, 429 = too many
  requests (retryable, retryAfter in seconds), 5xx and network errors = retryable.
- When my phone is offline the text waits (queued: true) and goes out as soon as the phone is back online.

What I want: [describe what should send a text, to whom, and when]

Rules for your code:
- Keep the API key in PropertiesService (SmsTunnel.setApiKey from a one-time prompt or dialog, which stores it in
  user properties). Never put the key in the code, in a cell, in a log, or in HTML/JavaScript that runs in the
  browser.
- Check every number with SmsTunnel.normalizePhone before sending; skip invalid ones and say why.
- Handle errors: stop and tell me on 401 or 403; leave the item for the next run on 429 or 5xx; write down what was
  sent so nothing is sent twice; cap the texts per run.
- Only send texts people expect from me: to people who gave me their number for these texts.
- Apps Script only: UrlFetchApp (no fetch), no setTimeout, no async/await; installable triggers for automation.
```

## Privacy and security

- **The key** stays in the script's user properties: only you can read it, and it is never written to a cell, a note or a log. The setup dialog shows only its last 4 characters. The library never keeps anyone's key: it reads the key from the project that calls it.
- **Who can change the script**: everyone with edit access to the spreadsheet or form can edit its script, and a trigger runs with the permissions of the person who set it up. Give edit access only to people you trust.
- **What leaves your file**: for each text, the number and the text go to SMSTunnel and to your phone. Logs stay in your spreadsheet. Nothing is sent anywhere else.
- **Safe writes**: anything SMSTunnel writes to a cell (an event title from someone else's invite, a reason from the server) is written as text, never as a formula.
- **Stop everything** by deleting the key under **Apps** in your SMSTunnel dashboard.

## Responsible use

Send only texts that people expect from you: reminders to yourself, appointment reminders, order updates, confirmations people asked for. Unsolicited texts from a personal SIM break most carriers' terms of service. Please make sure your use follows your carrier's terms and local rules (in the EU, that includes GDPR and the ePrivacy rules on electronic communications).

## Development

```bash
npm install           # two dev tools for the lint: acorn and acorn-walk
npm test              # apps-script/ up to date, the Apps Script lint, the unit tests
npm run test:e2e      # sends through a LOCAL SMSTunnel API and checks its MongoDB (never smstunnel.io)
npm run build         # rebuilds apps-script/ from src/
```

- `src/library/SmsTunnel.js` is the library, `src/shared/` holds what the templates share (`SmsTunnelKit.js`, the dialogs' CSS and JS), `src/projects/<name>/` each template's code, dialog and `appsscript.json`. `npm run build` puts each complete project together in `apps-script/<name>/`, ready to paste or to push with clasp ([PUBLISHING.md](PUBLISHING.md)).
- The tests run the shipped files in a small Apps Script runtime (one global scope, like Apps Script) with shims for UrlFetchApp, PropertiesService, SpreadsheetApp, FormApp, CalendarApp, ScriptApp and the rest. The code and number rules are also checked against the SMSTunnel server's own functions on tens of thousands of random inputs, when the server's source is next to this folder.
- The lint (`tools/lint-gas.mjs`) parses every shipped file as an ES2019 script and refuses what Apps Script can't run (`fetch`, `setTimeout`, `URL`, `async`, `?.`, look-behind...), checks that every menu item, trigger and dialog call names a function that exists, and checks each manifest's permissions.

SMSTunnel is not affiliated with, endorsed by, or sponsored by Google. Google, Google Sheets, Google Forms, Google Calendar and Google Apps Script are trademarks of Google LLC.

## License

[MIT](LICENSE) © 2026 NARBOWEB SRL
