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
  - A three-month week calendar, all-time totals with percentages between stages
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

## Setup

### 1. Database

The app expects a backend matching the schema in `migrations/`. The default is Supabase (the free tier is sufficient). Another backend is possible by replacing `data-supabase.js`: the rest of the app only talks to the data layer.

For testing without a backend there's a local data layer (`data-local.js`) that stores everything in the browser. See [Testing](#testing).

**Supabase setup:**

- Create a free project on [supabase.com](https://supabase.com), in an EU region
  - Enable **Data API**
  - Disable **Automatically expose new tables** (the schema grants access per table itself)
  - Enable **automatic RLS**
- Go to the SQL Editor, paste the contents of `migrations/001_initial.sql`, and click Run. Later migrations (`002_…`) follow the same way, in number order.
- Go to Settings > API and copy your **Project URL** and **publishable key**

### 2. Users

Supabase Auth manages user accounts. Self-registration is disabled by design.

- Go to Authentication > Sign In / Providers and disable **Allow new users to sign up**
- Go to Authentication > Users > **Create a new user** (e-mail and password)
- Share the credentials with your team member
- A member profile is created automatically. Its `name` in the `members` table is what the app shows at the top right; change it there if you like.

### 3. App

- Fork or clone this repo
- Put your Project URL and publishable key in `data-supabase.js`
- Check that `config.js` has `backend: 'supabase'` in `SETTINGS`
- Host the files wherever you like (for example GitHub Pages, Netlify or Cloudflare Pages)

### 4. Usage

- Open the URL in your browser and log in
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
- **Release in this order:**
  1. backup export
  2. run the new migration in the SQL Editor
  3. deploy the code
  4. check the versions in *Instellingen*
- **If the database and the app don't match,** the app says so and saves nothing.

## Testing

- **Rules:** `node tests/model.test.js` (no dependencies)
- **The app, without a backend:** set `backend: 'local'` in `config.js` and serve the folder locally:

  ```bash
  python3 -m http.server 8765
  ```

  - Open http://localhost:8765/tests/load-testdata.html to load a test data set, or a backup file (to try a new version on a copy of real data)
  - Then open http://localhost:8765/

  Local data lives in that browser only, per address.

## Configuration

`config.js` holds the settings that change rarely, each explained:
- the data layer (`backend`)
- plan start and end
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
- `migrations/` - numbered database changes. What each table holds is described in `docs/design.md`.
- `tests/` - tests for the rules, and the test data set

Code, database names and fixed values are English. Only the interface is Dutch.

## Security

- **Logins:** only invited users can log in (self-registration disabled)
- **Database rules:** Row Level Security is on for every table. Everyone logged in can read and edit all data; there are no roles yet.
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

## Roadmap

- [ ] Entry channels and via options managed in Instellingen (prepared, see `docs/design.md`)
- [ ] A second interface language
- [ ] Roles per user
- [ ] Live sync between users
- [ ] Merging duplicate companies
- [ ] Offline use
- [ ] Paging or server-side counts beyond a few thousand contacts

## License

All rights reserved. The code is visible, but using, copying, changing or selling it requires written permission from Orville. See `LICENSE`.
