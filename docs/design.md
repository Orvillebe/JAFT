# JAFT design (Just A Funnel Tool)

These are the agreed design decisions for JAFT. The mockup ([`JAFT_userinteraction_mockup.html`](JAFT_userinteraction_mockup.html)) shows the interaction, and this document records how the software behind it works. Where they differ, this document wins.

Status: **decided and built** in the local version. The Supabase path is written but not tested yet (see README).

## 1. Users, accounts and hosting

- **Users:** An and Vincent for now, possibly more later. Everyone sees all data.
- **Roles:** not built. The design keeps room for them: every record stores who created and changed it, and access rules live only in the database.
- **Database:** a **separate Supabase project** for JAFT, not the JATL project.
  - It's in the EU region, on the free plan.
  - It has its own `members` table, linked to Supabase Auth.
  - Self-registration is off; users are invited, as in JATL.
  - Row Level Security is on for every table.
- **Accounts:** no account management in the app for now (same as JATL). A shared login library for JATL and JAFT may come later, so all login code stays in one small part of the data layer.
- **Swappable database:** as in JATL, the app first runs on local storage, then Supabase is swapped in behind the same data layer.
- **Hosting:** GitHub Pages, a static site with no build step (same as JATL).

## 2. Backups and exports

- **Backup export** (Instellingen): everything, exactly as stored, as one JSON file. The page shows the date of the last export. The free Supabase plan has no restorable backups, so this is the safety net.
- **Analysis export** (Overzicht): one JSON file meant to be read by an AI.
  - It has one block per contact, with its history in date order, readable labels instead of codes, and calculated values such as current fase and days between fases.
  - It includes contact persons not yet contacted, companies with their website, note and creation date, every status change, every planned next step with whether it slipped, and the export date.
  - All free text is included as typed.
  - **Phone and e-mail are left out.** Company names are kept so the AI can look up the type of company.
- **Free text over structured fields:** extra structured fields add friction on input, and the AI reads the notes afterwards.

## 3. Language

- **Code, database, identifiers and fixed values are English.**
- **The interface is Dutch.** All interface text lives in one translation file (`nl.js`), and the code only uses keys. A second language later means adding a file, not changing code.
- **What users type is data** (names, notes, the names of in-between fases) and stays as typed.

## 4. Domain model

### Classes

```mermaid
classDiagram
  direction LR
  class Company {
    text name
    text phone
    text email
    text website
    text note
    archive()
    moveToBin()
  }
  class Person {
    text name
    text phone
    text email
    text jobTitle
    derived isContacted
    derived currentStage
    derived isActive
    derived nextStep
    derived amount
    archive()
    deactivate()
    activate()
    moveToBin()
  }
  class HistoryEntry {
    <<abstract>>
    date happenedOn
    text action
    text note
    text nextStep
    date nextStepOn
    edit()
    moveToBin()
  }
  class FirstContact {
    fixed entryChannel
    fixed via
    text hook
  }
  class FollowUp {
    number amount
  }
  class StatusChange {
    choice active_or_inactive
  }
  class Stage {
    text name
    number position
    kind start_middle_or_end
    derived isArchived
    archive()
    restore()
  }
  class StageChange {
    date happenedOn
    choice archived_or_restored
  }
  class WeekAction {
    date happenedOn
    choice event_or_post
    number value
  }
  class Member {
    text name
    text email
  }
  Company "0..1" -- "*" Person : has
  Person "1" *-- "*" HistoryEntry : has
  HistoryEntry <|-- FirstContact
  HistoryEntry <|-- FollowUp
  HistoryEntry <|-- StatusChange
  FirstContact "*" --> "1" Stage : starts in contact
  FollowUp "*" --> "0..1" Stage : moves to
  Stage "1" *-- "*" StageChange : has
  Member "1" -- "*" HistoryEntry : creates and changes
  Member "1" -- "*" WeekAction : taps
```

`derived` means the value is never stored; it's calculated from the history entries.

### Lifecycles

```mermaid
stateDiagram-v2
  direction LR
  state "Person" as P {
    [*] --> ContactPerson : added at a company
    [*] --> Active : new contact
    ContactPerson --> Active : first contact
    ContactPerson --> Bin : delete
    Active --> Inactive : leave alone for now
    Inactive --> Active : pick up again
    Active --> Archived : delete
    Inactive --> Archived : delete
    Archived --> Active : restore
    Bin --> ContactPerson : restore
    Bin --> [*] : after 30 days
  }
  state "Stage (middle stages only)" as S {
    [*] --> StageActive : created
    StageActive --> StageArchived : archive
    StageArchived --> StageActive : restore
  }
```

Restoring an archived person brings back the status it had, active or inactive.

## 5. Rules

### History

- **The state is calculated, never stored.** A person's current stage, active status, next step and amount come from its history entries, always in order of the date things **happened** (`happenedOn`). The entry moment only breaks ties on the same day. The same entries always give the same result, whatever order they were entered, backfilled, corrected or deleted in.
- **Two dates per entry:** `happenedOn` (used for every count) and the moment it was entered (`created at`).
- **Who and when:** every record stores `created by/at` and `changed by/at`.
- **Corrections overwrite the entry.** There's no correction trail.
- **Valid entries only:**
  - an entry must contain something (an action, stage, next step or note)
  - `happenedOn` can't be in the future
  - a next step's date comes after the entry's date
- **The first-contact entry can't be deleted on its own.** To remove it, archive the person.

### Stages (fases)

- **Contact** is the first stage. It's fixed, can't be archived, and every new contact starts in it.
- **Opdracht** (key `order`) is the last stage. It's fixed and can't be archived; it adds the field *amount*.
- **Middle stages** (initially Gesprek and Offerte) are managed in Instellingen: add, rename, reorder, archive and restore. **Never deleted.**
- **Every history entry** has the same base fields, whatever the stage: when, action, note and an optional next step. Amount appears only for Opdracht.
- **Choosing a stage:** the form shows the stages with the person's current stage selected. Leaving it selected means the entry doesn't change the stage; there's no separate "unchanged" option. When correcting an old entry, the selection starts at the stage the person was in just before it, or at the stage the entry set.
- **Free flow:** every *active* stage can be chosen at any time, so going back, going forward and skipping are all allowed. An archived stage can be left, but not chosen. Contacts that are in an archived stage stay there until moved.
- **Counting:** a stage counts once each time a person **enters** it from a different stage. Staying in the same stage doesn't count, and skipped stages don't count. Offerte → Gesprek → Offerte counts as two Offertes.
- **Overview:**
  - **Weeks:** a stage is shown in a week if it was active on at least one day of that week. This is why archiving and restoring are kept with their dates (`StageChange`).
  - **Totals:** only stages that aren't archived are shown.

### Deleting, archiving, inactive

| You delete | What happens |
|---|---|
| A history entry | Bin, restorable for 30 days, then gone |
| A contact person (not yet contacted) | Bin |
| A company with no persons | Bin |
| A company with persons | **Archive.** The confirmation lists the linked contacts and contact persons, which are archived together with it. |
| A contact | **Archive** (a contact is never empty) |

- **Archived means deleted for the user:** it's invisible, it isn't counted in the overview or the analysis export, and it can be restored from the Archief in Instellingen.
  - Things archived together are restored together.
  - Restoring a contact whose company is archived also restores the company.
- **Inactive means "leave alone for now":** the person stays findable with the filter, keeps counting, and can be reactivated.
- **Deleting always asks for confirmation** in a popup, and offers Ongedaan afterwards.
- **One place hides deleted and archived records:** the data layer doesn't load them. Only the Bin and the Archief ask for them.

### Next step

- **One open next step per person:** the most recently planned one.
- **It closes when:**
  - an action is done on or after its planned day, or
  - an action is done before its planned day **and** a new next step is planned (the new one replaces it).
- **It stays open when:**
  - an action is done before its planned day without a new step
  - only a note is added
  - only the stage changes

### Entry channels and via options

- **Both are fixed in the code** (one list each in `config.js`) and can't be changed in Instellingen.
  - Entry channels: `hook` (Haakje), `linkedin` (LinkedIn), `cold` (Koud).
  - Via options: `event` (Event), `referral` (Doorverwijzing), `other` (Andere).
- **Only Haakje asks for via and the hook text.**
- **The key is stored, never the label.** The Dutch labels come from the translation file.
- **Entry channel, via and hook text are stored on the first-contact entry,** because they describe how that first contact came about.

#### Future: entry channels and via options managed in Instellingen

Not built now, but expected as a possible later refactor, for either list or both. What it would take:

- **A table per list** (`entry_channels`, `vias`) like the middle stages: name, position, archived. Never deleted. Archived options keep their old records and can't be chosen for new contacts.
- **A setting per entry channel, "asks for via and hook".** This replaces the flag in `config.js`.
- **Existing records keep working,** because the fixed keys (`hook`, `linkedin`, `cold`, `event`, `referral`, `other`) become the ids of the initial rows.
- **Labels move** from the translation file to the data, like the names of middle stages.
- **The overview and the analysis export** group by whatever channels exist instead of the fixed three. Archived channels follow the same rules as archived stages.
- **Instellingen** gets a section per list, like the stages section.

What we do now to keep that refactor small:

- **Store a key, never a label.** First-contact entries store the channel key and the via key.
- **One list in the code per kind.** The form, the overview and the export read those lists, and nothing else checks for a specific channel or via by name, except through the `asksVia` flag.
- **One place to read them.** Screens get the options and their labels from the Store (`channels()`, `viaOptions()` and their labels), so swapping a fixed list for a table only touches the Store, the data layer and Instellingen.

### Overview percentages

- **"In totaal":** between two adjacent stages in funnel order, the percentage is the later stage's count divided by the earlier stage's count. For example, X contacts and Y gesprekken gives Y as a percentage of X.
- **Counts follow the counting rule above:** entries into a stage, over all time, for non-archived stages only.
- **Above 100% is possible:** because stages can be skipped or entered more than once, a later stage can exceed an earlier one. That's shown as is.

### Identity

- **No field is an identifier.** Everything is linked by a generated id. Two companies or two people can have the same name.
- **Duplicates get a warning, never a block:** "already exists, open that one / save as new anyway". Suggestion lists show extra details (website, company, phone) to tell duplicates apart.

### Weeks

- **The first day of the week is a shared setting** in Instellingen. Thursday is the default (in `config.js`), because Wednesday ends with the meeting and the planning.
- **Only the view depends on it.** Everything is stored by date, and weeks are calculated when the overview is shown. Changing the first day regroups the weeks, and nothing in the data changes.

### Week actions

- **Stored by date, not by week:** each tap is stored on the first day of the week it was made for. It counts for whatever week contains that date, so changing the first day of the week regroups it like everything else.
- **Events:** a +1 / −1 counter per week. Each tap is its own record, so two users tapping at the same time never lose a tap.
- **LinkedIn post:** a checkbox per week; the latest tap decides.
- **Both are for the team, not per person.** Each record keeps who tapped.

### Versions and changes

The app can change while the database keeps its data. These rules keep a running, filled database correct:

- **Migrations.** Every database change is a numbered file in `migrations/` (`001_initial.sql`, `002_…`). Each runs once, in order, and records itself in `schema_migrations`. A migration that has run is never edited; a fix is a new file.
- **Only additive changes in one step.**
  - A new column gets a default, so existing rows stay valid.
  - Renaming or removing goes in two releases: first add the new and copy the data over, then remove the old in a later release.
- **The version check.** `version.js` holds `SCHEMA_VERSION`, the migration number this code needs. At startup the app compares it with the database. If they differ, it loads and saves nothing:
  - **Database older:** the app says the migration still has to run.
  - **Database newer:** the app says this copy is outdated, for example a phone with a cached version, and offers to reload.
- **The local version follows the same steps.** `data-local.js` has one upgrade step per migration (`LOCAL_MIGRATIONS`), so local test data and imported backups are upgraded the same way as the real database.
- **Calculated, not stored.** Stage, next step, active status and all counts are recalculated from the history. Changing such a rule needs no data migration, but it also changes how past weeks are counted. That's intended, but worth knowing.
- **Test on a copy of real data.** The test page (`tests/load-testdata.html`) loads a backup file into the local version and upgrades it. A new version is tried there first.
- **Release order:**
  1. backup export
  2. run the new migration, if there is one
  3. push the new code
  4. check the version in Instellingen and click through

  Each step can be undone with the backup.

## 6. Interface decisions

- **Correcting history (phone):** swipe like in JATL. Swipe left shows *Bewerken*, swipe right shows *Verwijder*.
- **Correcting history (laptop):** a pencil and a × appear when you hover over an entry or reach it with the keyboard.
- **Editing:** the update form below the timeline fills with the entry's values, and the button becomes *Bewaar wijziging*.
- **Deleting:** always a confirmation popup.
- **Instellingen:** opened from your name in the top right, not a tab. It contains the backup export, the look (per device), the first day of the week, stages, the Bin, the Archief, and the app and database version.
- **Look:** three themes, chosen per device in Instellingen. *Licht* follows the mockup. *Orville donker* follows the house style of JATL (dark antraciet, Outfit, yellow-green accent). *Orville licht* uses the same colours on a light background: the yellow-green is a fill with dark text on it, links and accent text use a darker olive, and the funnel and the better weeks grow towards the full Orville green (never dark: it should feel like progress). All colours are named tokens at the top of `style.css`, so a theme only fills in those tokens. Opdracht stays gold in every theme.
- **Stage choice:** see *Choosing a stage* above. The current stage is selected, with no separate "Ongewijzigd" option.

## 7. Not in the model

- **Fields from the mockup's example data** (source, theme, problem, alternative, signals, "ons") are dropped. Insights like these come from the notes, through the analysis export.

## 8. Testing

- **A test data set that can be loaded for testing:** a believable history with many contacts, long names, archived stages, and contacts going back and forth and skipping stages.
- **It's part of testing, not of the app:** it's loaded into the local-storage version, and it's never part of the production code path or the Supabase data.

## 9. Open

- Nothing. Screens were built from these decisions and are tweaked by using them.
