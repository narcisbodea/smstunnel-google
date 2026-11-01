# Site page: SMSTunnel for Google Sheets, Forms and Calendar

Content for a future page on smstunnel.io (suggested path `/google`, or `/integrations/google-calendar` with the Sheets and Forms parts as sections). The site's owner decides the layout; everything below is the text and the facts to show. Template links and the library's Script ID come from PUBLISHING.md once they exist.

---

**Page title (`<title>`):** Text reminders from Google Calendar, Sheets and Forms, from your own phone · SMSTunnel

**Meta description:** Send text reminders from Google Calendar, and texts from Google Sheets and Google Forms, through your own Android phone and your own number. Free templates, no server.

**Badge on the page (and on the cards):** the Google Play badge `https://smstunnel.io/google-play-badge.png`, linking to `https://play.google.com/store/apps/details?id=io.smstunnel.app`.

---

## Hero

### Text reminders for Google Calendar, Sheets and Forms. From your own phone.

Your spreadsheet, form or calendar hands each text to SMSTunnel, and your Android phone sends it from its own number. People see a number they know, and they can reply to you.

[Get the Calendar template] [See all templates]

Small print under the buttons: *Free templates. Works with a free Google account. No server to run.*

## Google Calendar no longer texts you. This does.

Google Calendar stopped sending SMS notifications on 7 January 2019; since then its reminders come as app and email notifications only ([Google Workspace Updates](https://workspaceupdates.googleblog.com/2018/11/google-calendar-sms-notifications-to-be-removed.html)). SMSTunnel for Google Calendar brings text reminders back, sent by your own phone:

- **Remind me**: a text before each event, 5 minutes to a day before. Only the calendars you choose, and only events with a word you choose if you like ("dentist").
- **My agenda**: one text every morning: *"Today, Mon, Nov 2: 9:00 AM Dentist, 2:00 PM Call with Ana."*
- **Remind your clients**: for appointments, the person in the event gets a reminder from your number, the day before or a few hours before. Their number comes from a line like `SMS: +1 415 555 0123` in the event, or, for guests you invite, from the list of their numbers you keep in the template's "Phone numbers" sheet.

Each reminder goes out once. If an event moves, the new time gets one new text.

## Four ready templates

**SMSTunnel for Google Calendar.** Texts to you before your events, your daily agenda, and reminders to the people in your appointments. [Make a copy]

**SMSTunnel for Google Forms.** A text to you for each new response, and, if you want, a confirmation text to the person who answered. [Make a copy]

**SMSTunnel for Google Sheets: status texts.** When a row's status becomes "Shipped" or "Ready", the number in that row gets your text, with the row's details filled in: *"Hi Ana, your order A-100 has shipped."* Once per row. [Make a copy]

**SMSTunnel for Google Sheets: appointment reminders.** Each appointment in your sheet gets one reminder text a few hours before, between the hours you allow. [Make a copy]

**For developers:** the SMSTunnel library for Google Apps Script: `SmsTunnel.sendSms('+14155550123', 'Your order has shipped.')`. [How to add it]

## Set up in five minutes

1. **Install the SMSTunnel app** on your Android phone and sign in. [Google Play badge]
2. **Make a key**: in your SMSTunnel dashboard, open Apps → Add an app and copy the key.
3. **Copy a template**, open SMSTunnel → Set up, paste the key and choose what to send. Send yourself a test text, and you're done.

## What Google asks when you set it up

The first time, Google asks you to allow the script. Because the copy is your own script, which Google hasn't reviewed, Google shows "Google hasn't verified this app": click Advanced, then Go to the template's name. You can read every line of the script first, in Extensions → Apps Script.

The script asks only for what it uses: to reach SMSTunnel, to read this one spreadsheet or form (or your calendars, read-only, for the Calendar template), to show its menu and setup dialog, and to run on its own when the time comes.

## Questions

**Does it cost anything?**
The templates are free, and Google Apps Script is free with any Google account. The texts count against your SMSTunnel plan, and your mobile plan applies to the texts your phone sends.

**Whose number do people see?**
Yours. The texts leave your own phone, from its SIM, like a text you type yourself. Replies come back to your phone.

**What if my phone is off?**
The text waits and goes out as soon as your phone is back online.

**Can it text everyone in my sheet at once?**
No, and on purpose. Each template texts only the numbers it was set up for: your own numbers, the row whose status changed, the appointment coming up, the person in an event. One text per number, with a limit per run. Send texts only to people who gave you their number for them.

**Will it text a number twice?**
No. Every template writes down what it sent ("Texted at", "Reminder sent", or a hidden list for the calendar) and checks it before each text.

**Where is my key kept?**
In the script's own private storage for your account, which only you can read. It never goes into a cell or a log. Delete the key under Apps in your dashboard and every text stops at once.

**Does it work with Google Workspace accounts?**
Yes, with personal Google accounts and Google Workspace accounts. Workspace accounts get higher daily limits from Google.

## Build your own with an AI assistant

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

## Footer note for this page

SMSTunnel is not affiliated with, endorsed by, or sponsored by Google. Google, Google Sheets, Google Forms, Google Calendar and Google Apps Script are trademarks of Google LLC.

---

### Notes for whoever builds the page

- Keep the wording rules of the site: "your own phone", "your own number"; one text per person.
- The four "Make a copy" buttons link to the template links from PUBLISHING.md (section 2.3); until they exist, link the buttons to the GitHub folder of each template, or hide them.
- Screenshots worth taking from a real copy: the SMSTunnel menu, the Calendar setup dialog, a reminder text arriving on a phone, the "Texted at" column.
