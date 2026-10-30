# JAFT

Contact follow-up for the Orville 90-day plan. You log every contact and every step through your own stages (Contact → … → Opdracht). The overview then shows, week by week, whether you're moving forward.

It's a static site with no build step, the same kind of tool as JATL: vanilla JS and Supabase (its own project), hosted on GitHub Pages.

- **Interaction:** the mockup in [`docs/JAFT_userinteraction_mockup.html`](docs/JAFT_userinteraction_mockup.html) shows how it should behave.
- **Design:** [`docs/design.md`](docs/design.md) records every decision behind it: data model, rules, deleting and archiving, exports. Where the two differ, the design wins.

## Status

- **Runs locally** in this browser (`backend: 'local'` in `config.js`), with a test data set to load.
- **Supabase is prepared but not live yet.** `migrations/001_initial.sql` and `data-supabase.js` are written, but the JAFT Supabase project doesn't exist yet, so the Supabase path is **untested**. See [Going live on Supabase](#going-live-on-supabase).

## Features

- **Contact ingeven**
  - Search everything at once, with filters on status and stage and three sort orders
  - New contacts with company and contact-person suggestions. Duplicate names get a warning, never a block.
  - Contact detail with a timeline, an active/inactive switch, and updates: action, any active stage (back, forward or skipping; the current stage starts selected), amount for Opdracht, next step, note
  - Correct or delete timeline entries: swipe on a phone (left = Bewerken, right = Verwijder, as in JATL), or use the pencil and × on a laptop
- **Bedrijven:** company details, contact persons not yet contacted, and the contacts at the company
- **Overzicht**
  - Per week: new contacts per ingang and the flow through the stages shown that week, with a ▲ wherever it beats last week up to the same weekday
  - Events +/−, the LinkedIn post, a three-month week calendar, totals with percentages, and the analysis export
- **Instellingen** (under your name, top right)
  - Backup export
  - The look: *Licht* (the mockup) or *Orville* (the house style of JATL), per device
  - The first day of the week (shared by everyone)
  - Stages (add, rename, reorder, archive and restore; never delete)
  - Prullenbak (30 days) and Archief, with restore
  - The app version and the database version
- **Ongedaan** after every save or delete

## Trying it locally

A local server is needed:

```bash
python3 -m http.server 8765
```

On a phone on the same Wi-Fi, use the Mac's address instead of `localhost` (for example `http://192.168.1.30:8765/`). Each browser keeps its own local data, so load the test data there too.

1. Open http://localhost:8765/tests/load-testdata.html and click **Load test data**. This replaces the local data in this browser only.
2. Open http://localhost:8765/

Without test data, the app starts empty with the default middle stages (Gesprek and Offerte).

## Going live on Supabase

1. **Create a new Supabase project** for JAFT (not the JATL project) in an EU region. During creation, enable the Data API and automatic RLS.
2. **SQL Editor:** paste `migrations/001_initial.sql` and run it. This creates the tables, the access rules, the initial stages, three functions, and the version table.
3. **Authentication > Sign In / Providers:** turn off *Allow new users to sign up*.
4. **Authentication > Users > Create a new user** for each person. A member profile is created automatically.
5. **Settings > API:** copy the project URL and the publishable key into `data-supabase.js`.
6. **`config.js`:** set `backend: 'supabase'` in `SETTINGS`.
7. Push to a repo under Orvillebe and enable GitHub Pages.

The local data doesn't move over automatically.

## Changing the app later

The database keeps its data while the app changes. The rules are in `docs/design.md` under *Versions and changes*. In short:

- **Every database change** is a new numbered file in `migrations/`. Never edit one that has run.
- **When you add a migration,** raise `SCHEMA_VERSION` in `version.js` to its number, and add the same step to `LOCAL_MIGRATIONS` in `data-local.js`.
- **Raise `APP_VERSION`** in `version.js` with every release. Instellingen shows it.
- **Test first on a copy of real data:** export a backup in Instellingen, load it on `tests/load-testdata.html`, and click through the new version locally.
- **Release in this order:**
  1. backup export
  2. run the new migration in the Supabase SQL Editor
  3. push the code
  4. check the versions in Instellingen

  If the database and the app don't match, the app says so and saves nothing.
- **Caching:** GitHub Pages can serve a cached copy for about 10 minutes. A phone that still has the old app gets the "reload" message once the database is newer.

## Usage

- **New contact:** type a name or company in the search field. The `+ Nieuw: naam` and `+ Nieuw: bedrijf` buttons fill in the form.
- **Follow up:** tap a contact, fill in what happened, and save. You can choose any active stage.
- **Correct a mistake:** swipe a timeline row (phone), or hover over it and use the pencil or × (laptop). The row's values fill the form below. Deleting always asks first.
- **Delete a contact:** *Contact verwijderen* at the bottom of a contact archives it. Use the active switch instead for "leave alone for now".
- **Contact persons:** under *Bedrijven*, add people you haven't contacted yet. *Eerste contact met deze persoon ingeven* turns them into a contact.
- **Events and post:** on *Overzicht*, +/− and the checkbox count for the selected week, for the team.
- **Analysis:** *Exporteer voor analyse* on *Overzicht* produces a JSON file to give to an AI. Person names are replaced by a number, and phone and e-mail are left out.

## Configuration

`config.js` holds the settings that change rarely, each explained:
- which data layer to use (`backend`)
- plan start and end, and the default first day of the week (Thursday, so a week closes after the Wednesday meeting; changeable in Instellingen)
- list length and bin period
- the fixed ingangen (entry channels) and via options

Invalid values fall back to the default and are logged in the console. Stages are data, managed in Instellingen.

## Security and privacy

- **Logins:** only invited users can log in, because registration is off in the JAFT project.
- **Access rules:** Row Level Security is on for every table. Everyone logged in sees and edits all data; there are no roles yet.
- **Fixed stages:** Contact and Opdracht can't be archived, which the database enforces.
- **Who did what:** every record stores who created and changed it, and when.
- **The key in the code** is the publishable one and safe to publish, because RLS enforces all access.
- **No tracking:** there's no telemetry. The only external requests are the Supabase client library from jsDelivr and the Outfit font from Google Fonts.
- **Backups:** the free Supabase plan has no restorable backups, so export one regularly from Instellingen. The page shows when this device last did.

## Troubleshooting

- **"Laden lukte niet":** for Supabase, check that the migrations ran and that the URL and key in `data-supabase.js` are right.
- **"De database staat op versie …":** a migration in `migrations/` still has to run, or the app is outdated and needs a reload. The message says which.
- **Changes from a colleague don't show up:** the app reloads when you return to it after a minute or more. A manual reload always works.
- **The local version shows old data:** reload the test data, or empty it on `tests/load-testdata.html`.
- **Errors:** details go to the browser console.

## Code structure

There's one file per task. All rules live in `model.js`, which touches neither the DOM nor the data, so they can be tested.

| File | Responsibility |
|---|---|
| `index.html`, `style.css` | Page structure and styling. All colours are tokens at the top of `style.css`: the light theme (from the mockup) and the Orville theme. |
| `config.js` | Rarely changed settings, the single place for defaults |
| `i18n/nl.js`, `i18n/i18n.js` | All interface text by key. Another language means another file. |
| `model.js` | Calendar, stages, a person's state from its history, week counts, next-step outcomes |
| `data-local.js`, `data-supabase.js`, `data-service.js` | Two interchangeable data layers, and the switch between them |
| `store.js` | Data in memory, every save with its undo, bin and archive rules |
| `ui.js` | Toast, the *Net ingegeven* list, the reward message, swipe rows |
| `contacts.js`, `companies.js`, `overview.js`, `settings.js` | The screens |
| `export.js` | Backup and analysis export |
| `id.js` | New record ids, also over plain http on the local network |
| `version.js` | App version, and the database version this code needs |
| `app.js` | Login, loading, switching pages, the menu |
| `migrations/` | Numbered database changes. `001_initial.sql` holds the tables, RLS, initial stages, multi-row functions and the version table. |
| `tests/model.test.js` | Tests for the rules: `node tests/model.test.js` |
| `tests/testdata.js`, `tests/load-testdata.html` | Test data set for the local version (testing only) |

Code, database names and fixed values are English. Only the interface is Dutch.

## Removing

- **Supabase:** delete the JAFT project in the Supabase dashboard. JATL isn't affected.
- **Local data:** use *Empty local data* on `tests/load-testdata.html`, or clear the site data in your browser.

## Future improvements

- **Ingangen and via options managed in Instellingen:** prepared, see `docs/design.md`.
- **Roles per user:** when the team grows. Who-did-what is already stored.
- **Live sync between users** (Supabase Realtime): reloading on return is enough for two users.
- **Merging duplicate companies:** for now, link contacts to the right company and delete the empty one.
- **Offline use or a service worker:** the app can be installed, but needs a connection.
- **Moving local data to Supabase:** not built. The backup file has the right shape for a one-off import if it's ever needed.
- **Cache busting** (version numbers on script files): not needed yet, because the version check catches an outdated copy.
- **A shared "last backup" date:** it's per device for now.
- **Loading everything at start** is fine up to a few thousand contacts. Beyond that it needs paging or server-side counts.

## License

MIT
