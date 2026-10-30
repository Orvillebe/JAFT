# JAFT - Just A Funnel Tool

Contact follow-up for small teams. You log every contact and every step it takes through your own stages (Contact → … → Opdracht). The overview then shows, week by week, whether you're moving forward. Static site, no build step required.

The design decisions behind it (data model, rules, deleting and archiving, exports, versions) are in [`docs/design.md`](docs/design.md).

## Features

- **Contacts**
  - Search everything at once, with filters on status and stage and three sort orders
  - New contacts with suggestions for company and contact person. Duplicate names get a warning, never a block.
  - Per contact: a timeline and an active/inactive switch. Updates can record an action, any active stage (back, forward or skipping), an amount for Opdracht, a next step and a note.
  - Correct or delete timeline entries: swipe on a phone (left = edit, right = delete), or use the pencil and × on a laptop
- **Companies** with their details, contact persons not yet contacted, and the contacts at the company
- **Overview**
  - Per week: new contacts per entry channel and the flow through the stages, with a ▲ wherever it beats last week up to the same weekday
  - Events and LinkedIn posts per week
  - A three-month week calendar from your first activity up to this week, all-time totals with percentages between stages
  - An export for analysis by an AI
- **Settings** (under your name, top right)
  - Backup export
  - Look: *Orville licht* (default), *Orville donker* or *Neutraal*, per device
  - The first day of the week, shared by everyone
  - Stages: add, rename, reorder, archive and restore (never delete)
  - Bin (30 days) and archive, with restore
  - App version and database version
- **Undo** after every save or delete
- **Authentication:** only invited users can access it
- **On your phone's home screen:** it opens like an app, without the browser bar, with its own icon

## Setup

### 1. Database

The app expects a backend matching the schema in `migrations/`. The default is Supabase (the free tier is sufficient). Another backend is possible by replacing `data-supabase.js`: the rest of the app only talks to the data layer.

Everywhere except the live address, the app uses a local data layer (`data-local.js`) that stores everything in the browser. See [Testing](#testing).

**Supabase setup:**

- Create a free project on [supabase.com](https://supabase.com), in an EU region
  - Enable **Data API**
  - Disable **Automatically expose new tables** (the schema grants access per table itself)
  - Enable **automatic RLS**
- Go to the SQL Editor, paste the contents of `migrations/001_initial.sql`, and click Run. Later migrations (`002_…`) follow the same way, in number order.
- Go to Settings > API and copy your **Project URL** and **publishable key**

### 2. Users

Supabase Auth manages user accounts. Self-registration is disabled by design, and a login alone gives no access: a user also has to be on the access list.

- Go to Authentication > Sign In / Providers and disable **Allow new users to sign up**
- Go to Authentication > Users > **Create a new user** (e-mail and password)
- A member profile is created automatically in the `members` table, with `allowed` off
- Go to Table Editor > `members` and set **`allowed`** to true for that person. Until then they can log in, but see a "no access" message and nothing else.
- Share the credentials with your team member
- `name` in the `members` table is what the app shows at the top right; change it there if you like

### 3. App

- Fork or clone this repo
- Put your Project URL and publishable key in `data-supabase.js`
- Put the address where the app will run in `productionHosts` in `config.js` (for example `yourname.github.io`). Only there does the app use the real database.
- Host the files wherever you like (for example GitHub Pages, Netlify or Cloudflare Pages), publishing from the `main` branch

### 4. Usage

- Open the URL in your browser and log in
- **On a phone:** choose *Add to Home Screen* in the browser's share or menu button to open JAFT like an app
- **New contact:** type a name or company in the search field; the `+ Nieuw: naam` and `+ Nieuw: bedrijf` buttons fill in the form
- **Follow up:** tap a contact, fill in what happened, and save
- **Correct a mistake:** swipe a timeline row, or hover over it and use the pencil or ×. Deleting always asks first.
- **Delete a contact:** *Contact verwijderen* at the bottom archives it. Use the active switch instead for "leave alone for now".
- **Contact persons:** under *Bedrijven*, add people you haven't contacted yet, and enter the first contact from there
- **Stages, first day of the week, bin and archive:** under *Instellingen*
- **Backups:** export one regularly from *Instellingen*

## Changing the app

The database keeps its data while the app changes. The rules are in `docs/design.md` under *Versions and changes*. In short:

- **Every database change** is a new numbered file in `migrations/`. Never edit one that has run.
- **When you add a migration,** raise `SCHEMA_VERSION` in `version.js` to its number, and add the same step to `LOCAL_MIGRATIONS` in `data-local.js`.
- **Raise `APP_VERSION`** in `version.js` with every release.
- **Two branches:** work goes to `dev`; `main` is what's published (production). Pushing to `dev` never changes the live app.
- **Release in this order:**
  1. backup export
  2. run the new migration in the SQL Editor
  3. merge `dev` into `main` (a pull request on GitHub)
  4. check the versions in *Instellingen*
- **If the database and the app don't match,** the app says so and saves nothing.

## Restoring a backup

If data is lost, a backup export (*Instellingen* › *Exporteer alles*) can be put back:

1. **Database ready:** the migrations have run, and it holds no contacts, companies or week actions yet. Users are not restored: create them again and set `allowed` to true.
2. **Make the script:** open `tools/restore.html` (locally or on the live address) and choose the backup file. The file stays in your browser. You get an SQL script.
3. **Run it:** Supabase › SQL Editor › New query › paste › Run. The check at the end should show the same counts as the first lines of the script.

The script runs as one transaction and stops on its own when the database version doesn't match or the database isn't empty. Everything comes back as it was: ids, dates, bin and archive. "Created by" only points to users that exist in the database.

## Testing

- **Rules:** `node tests/model.test.js` (no dependencies)
- **Restore script:** `node tests/restore.test.js`
- **The app:** serve the folder locally. Away from the live address the app always uses local test data in the browser, so testing never touches the real database. The orange bar at the top shows it, and there's no login.

  ```bash
  python3 -m http.server 8765
  ```

  - Open http://localhost:8765/tests/load-testdata.html to load a test data set, or a backup file (to try a new version on a copy of real data)
  - Then open http://localhost:8765/

  Local data lives in that browser only, per address.

## Configuration

`config.js` holds the settings that change rarely, each explained:
- the live address (`productionHosts`): only there is the real database used
- the default first day of the week
- list length and bin period
- the entry channels and via options

Invalid values fall back to the default and are logged in the console.

## Files

- `index.html` - page structure
- `style.css` - styling; all colours are tokens at the top, one block per look
- `config.js` - rarely changed settings
- `version.js` - app version, and the database version this code needs
- `i18n/` - all interface text by key (`nl.js`). Another language is another file.
- `model.js` - all rules: calendar, stages, a person's state from its history, week counts
- `data-service.js` - picks the data layer
  - `data-supabase.js` - Supabase (replaceable)
  - `data-local.js` - local storage, for testing
- `store.js` - data in memory, saving with undo, bin and archive
- `ui.js`, `contacts.js`, `companies.js`, `overview.js`, `settings.js`, `export.js`, `app.js` - the screens and shared interface pieces
- `id.js` - new record ids
- `manifest.json`, `icon.svg`, `apple-touch-icon.png` - name, colours and icon for the home screen
- `migrations/` - numbered database changes. What each table holds is described in `docs/design.md`.
- `tools/restore.html`, `tools/restore.js` - turn a backup into an SQL script that restores it
- `tests/` - tests for the rules and the restore script, and the test data set

Code, database names and fixed values are English. Only the interface is Dutch.

## Security

- **Logins:** only invited users can log in (self-registration disabled)
- **Access list:** every database rule checks "logged in **and** on the list" (`members.allowed`). An account created by mistake, or after sign-up was switched on by accident, can log in but sees and changes nothing. Nobody can put themselves on the list: users can only change their own name.
- **Database rules:** Row Level Security is on for every table. Everyone on the list can read and edit all data; there are no roles yet.
- **Without logging in** nothing can be read, written or called
- **Fixed stages:** Contact and Opdracht can't be archived, which the database enforces
- **Who did what:** every record stores who created and changed it, and when
- **The key in the code:** the publishable key is safe to publish, because RLS enforces all access rules
- **No telemetry.** The only external requests are the Supabase client library and the Outfit font.
- **Backups:** the free Supabase plan has no restorable backups, so export one regularly

## Troubleshooting

- **"Laden lukte niet":** check that the migrations ran and that the URL and key in `data-supabase.js` are right
- **"De database staat op versie …":** a migration still has to run, or the app is outdated and needs a reload. The message says which.
- **Changes from a colleague don't show up:** the app reloads when you return to it after a minute or more. A manual reload always works.
- **Errors:** details go to the browser console

## Removing

- **Supabase:** delete the project in the Supabase dashboard
- **Local data:** use *Empty local data* on `tests/load-testdata.html`, or clear the site data in your browser

## Known limitations

- **Changes by a colleague** show up when you return to the app after a minute or more, or after a reload. They aren't pushed live.
- **The last save wins.** When two people change the same thing, the change saved last stays, and that includes an undo: undoing your own change can overwrite a colleague's later change to the same record.
- **The app needs a connection.** It can be installed on a phone's home screen, but doesn't work offline.
- **Two companies with the same name** can't be merged. Link the contacts to the right company and delete the empty one.
- **Everything is loaded at start.** That's fine up to a few thousand contacts.

## Possible future

Possibilities, not plans. What each would take is in `docs/design.md`, under *Possible future*.

- A second interface language
- Entry channels and via options managed in Instellingen
- Roles per user
- A full installable app (PWA): the app's files kept on the phone, so it opens without a connection, with a notice when a new version is out
- Entering data offline, saved and synced once there's a connection again

## License

MIT with the Commons Clause: you may use, copy, change and share JAFT freely, but selling it (including a paid product or service built mainly on it) requires written permission from Orville. See `LICENSE`.
