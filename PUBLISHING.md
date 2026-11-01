# Publishing SMSTunnel for Google Sheets, Forms and Calendar

Nothing here is published yet. These are the steps to publish it **with your own Google account**: the library as an Apps Script library others can add by its Script ID, and the four templates as public **Make a copy** links. A separate section at the end covers a Google Workspace Marketplace add-on, for later.

No Google review is needed for the library and the templates: a copy of a template is the user's own script, in their own account, and the library runs inside the user's own project. Google shows each user its "unverified app" screen for their own copy (the README explains it), and the limit Google puts on unverified apps doesn't come into play, because each copy has a single user.

## What you need

- A Google account to own the published files. A dedicated one (for example an `apps@` address of NARBOWEB) keeps your personal Drive out of it, and its name shows as the owner of the shared files.
- Node.js 22 or newer and clasp 3: `npm install -g @google/clasp`.
- The Apps Script API turned on for that account: open https://script.google.com/home/usersettings and switch **Google Apps Script API** on.

```bash
clasp login        # opens the browser: sign in with the publishing account and allow clasp
```

`clasp login` keeps its token in `~/.clasprc.json`, outside this folder. Each project folder gets a `.clasp.json` with its Script ID when you create it; `.clasp.json` is git-ignored, so the IDs stay out of the repository (they are not secrets, just not needed there).

Before each publish, check the build and the tests:

```bash
npm install
npm test              # apps-script/ up to date, lint, unit tests
npm run test:e2e      # optional: against a local SMSTunnel API
```

## 1. The library

```bash
cd apps-script/library
clasp create-script --title "SMSTunnel" --rootDir .
clasp push --force
clasp create-version "SMSTunnel 1.0.0"
clasp open-script
```

`create-script` without `--type` or `--parentId` makes a standalone project. `push --force` replaces the online manifest with `appsscript.json`. `create-version` makes version 1, the one library users choose.

In the editor that `open-script` opens:

1. **Share** (top right) → **General access: Anyone with the link**, role **Viewer**. People need view access to add a library; they can't change it.
2. **Project Settings** → copy the **Script ID**.
3. Put the Script ID in the README ("Use the library in your own scripts") and in the site page, in place of "added here once the library is published".

To publish a new version later: change the version in `src/library/SmsTunnel.js` (the header and `VERSION`) and in `package.json`, run `npm run build` and `npm test`, then `clasp push --force` and `clasp create-version "SMSTunnel 1.0.1"`. Library users keep the version they picked until they choose the new one under **Libraries**.

## 2. The templates

Do this once per template. The script is bound to a file you make first, so the template link copies the file and its script together.

| Folder | File to make in Google Drive | Title |
| --- | --- | --- |
| `apps-script/calendar-reminders` | a Google Sheet | SMSTunnel for Google Calendar |
| `apps-script/forms-text-me` | a Google Form | SMSTunnel for Google Forms |
| `apps-script/sheets-status-texts` | a Google Sheet | SMSTunnel for Google Sheets: status texts |
| `apps-script/sheets-reminders` | a Google Sheet | SMSTunnel for Google Sheets: appointment reminders |

### 2.1 Make the file

Create it in Drive with the title above, and give it a starting point people recognize:

- **Calendar**: rename the first sheet to `Start here` and write in A1:A3 "1. SMSTunnel menu → Set up", "2. Paste your key from Apps → Add an app at dashboard.smstunnel.io", "3. Send me a test reminder". Add a sheet `Phone numbers` with the header row `Email | Phone | Name | Note`.
- **Status texts**: a sheet `Orders` with the header row `Name | Order | Phone | Status` and one sample row, `Ana | A-100 | +1 415 555 0100 | Packing` (a 555-01xx number is reserved for fiction). Select column C and choose **Format → Number → Plain text**.
- **Appointment reminders**: a sheet `Appointments` with the header row `Name | Phone | Date | Time` and one sample row with a date next week. Column B as plain text, column C as a date, column D as a time.
- **Forms**: three questions: `Your name` (short answer), `Phone number` (short answer, description "We'll text you a confirmation"), and a checkbox `Text me a confirmation` with one option, `Yes, text me`.

Copy the file's ID from its address: the part between `/d/` and `/edit`.

### 2.2 Bind and push the script

```bash
cd apps-script/calendar-reminders            # or forms-text-me, sheets-status-texts, sheets-reminders
clasp create-script --parentId <FILE_ID> --title "SMSTunnel for Google Calendar" --rootDir .
clasp push --force
```

Open the file and reload it: the **SMSTunnel** menu shows up (for the form, in the form's editor).

**Don't run Set up in the file you share.** Test in a copy instead (**File → Make a copy**, or the template link from 2.3), with a real key and your phone: Set up, **Send a test text** / **Send me a test reminder**, one real run (a status change, a form response, a due appointment, an event 10 minutes away), then **Turn texts off** and delete that key under Apps. If you ran Set up in the original by mistake, use **Turn texts off**, then **Set up → Forget my key**, and check **Extensions → Apps Script → Project Settings → Script properties** is empty.

### 2.3 Share it as a template link

1. **Share → General access: Anyone with the link**, role **Viewer**.
2. The template link is the file's address with `/copy` at the end instead of `/edit…`:
   - spreadsheets: `https://docs.google.com/spreadsheets/d/<FILE_ID>/copy`
   - the form: `https://docs.google.com/forms/d/<FILE_ID>/copy`
3. Open the link in a private window with another account: Google offers **Make a copy** and copies the script with the file. The copy has no settings, no key and no triggers of yours (user properties and triggers belong to each person).
4. Put the four links in the README's template table and on the site page.

### 2.4 Updating a template

Run `npm run build`, then `clasp push --force` in its folder. New copies get the new code; copies people already made keep theirs (each copy is independent). The README's "By pasting the code" steps also work for updating a copy: paste the new `SmsTunnel`, `SmsTunnelKit`, `Code` and `Setup`.

### Before you announce it

- Check the place of the SMSTunnel menu in the current Google Forms editor and adjust the README's sentence if Google moved it.
- Read Google's consent screen in a fresh copy and compare it with the README's permission table.
- Add the page from `site-page.md` to smstunnel.io and link it from the README and the dashboard's **Apps → Add an app** list.

## 3. Later, maybe: a Google Workspace Marketplace add-on

An add-on would let people install SMSTunnel into Sheets or Forms from the Marketplace (**Extensions → Add-ons → Get add-ons**) instead of copying a file, and it would show up in Marketplace searches. It is a different kind of publishing, with Google reviews. Here is what it takes, so you can decide later.

### What Google requires

1. **A standard Google Cloud project** (https://console.cloud.google.com), linked to the Apps Script project: **Project Settings → Google Cloud Platform (GCP) Project → Change project**, with the project number. The Cloud project then owns the OAuth client and the quotas of the add-on.
2. **The OAuth consent screen** (Google Auth Platform → Branding): app name, user support email, logo, home page, privacy policy and terms of service URLs on smstunnel.io, and smstunnel.io as an authorized domain, verified in Google Search Console. The privacy policy must say what the add-on does with Google user data (it reads rows, responses or events to send the texts you set up, and keeps nothing else) and follow the Google API Services User Data Policy, including its Limited Use rules.
3. **OAuth verification** for sensitive scopes: `calendar.readonly` is one; the console marks each scope's class when you add it. Google asks for a justification of each scope and usually a demo video (unlisted YouTube) showing the consent screen and how each scope is used. Google says most verification requests get a first answer within 24 to 72 hours; with questions back and forth it can take a few weeks. Until verification, at most 100 users can authorize the unverified add-on, each through the warning screen.
4. **The Marketplace SDK** in the same Cloud project:
   - App configuration: Editor add-on, the host apps (Sheets, or Forms), the Apps Script deployment ID (`clasp create-version`, then `clasp create-deployment --versionNumber <N> --description "1.0.0"`), and the same scopes as the manifest.
   - Store listing: name, short and full description, category, icons (32×32 and 128×128), a banner (220×140), at least one screenshot (1280×800), support, terms and privacy links, pricing (free, or free with paid features) and visibility (public, or private to your domain).
5. **The Marketplace review** of the listing and the add-on's behavior, after the OAuth verification. It usually takes days to a few weeks and may come back with requested changes.

### What would change in the code

- One add-on per Google app: a Sheets add-on (status texts, appointment reminders and Calendar could live together in it, as separate menu items) and a Forms add-on.
- Menus: `createAddonMenu()` instead of `createMenu('SMSTunnel')`, and an `onInstall(e)` that calls `onOpen(e)`.
- `onOpen` may run before the user turns the add-on on in a file (no authorization yet): it should only add the menu. The Calendar template's first-open hint would go.
- **Triggers are more limited for add-ons**: one trigger of each type per user per file, and time-driven triggers no more than once an hour. "Remind me 5 to 45 minutes before" can't work as an add-on: reminders would be "within the hour before" at best, and the agenda would come at a random minute of its hour. The status texts (edit trigger plus one 15-minute check) would lose the 15-minute check (hourly instead).
- Settings, the key in user properties, the one-setup-per-file rule, the log and the never-twice records stay as they are.
- Updates go out through new deployments; users get them without copying anything.

### Templates or an add-on?

| | Template copies (this repository) | Marketplace add-on |
| --- | --- | --- |
| Google review | none | OAuth verification + Marketplace review |
| What you need | a Google account | a Cloud project, a privacy policy and terms pages, a verified domain, listing images, a demo video |
| Reminders 5 to 45 minutes before an event | yes | no (hourly at best) |
| Updates reach existing users | no (they paste the new code or copy again) | yes |
| Found by searching the Marketplace | no | yes |
| The "unverified app" screen | yes, for each user's own copy | no, once verified |

Starting with the template links costs nothing and keeps every feature; an add-on is worth it once there is demand from people who don't want to copy files.
