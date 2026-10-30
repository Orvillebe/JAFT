/**
 * JAFT test data - a believable history for testing the local version.
 *
 * Responsibilities:
 *   - Build a full local data set (the same shape data-local.js stores):
 *     many contacts, long names, contact persons not yet contacted, companies without people,
 *     contacts going back and forth and skipping stages, inactive contacts,
 *     an archived middle stage and an archived via option, items in the bin and the archive,
 *     events and LinkedIn posts per week
 *   - Deterministic: the same seed gives the same data, relative to today
 *
 * Part of testing, not of the app: only tests/load-testdata.html uses it.
 */

function makeTestData(cfg, M, seed = 7) {
  let s = seed;
  const R = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = a => a[Math.floor(R() * a.length)];
  const int = (a, b) => a + Math.floor(R() * (b - a + 1));
  let n = 0;
  const id = () => 'test-' + (++n).toString(36) + '-' + Math.floor(R() * 1e9).toString(36);
  const T = Math.max(0, M.today());
  const ts = (d, k = 0) => new Date(M.dateOf(d).getTime() + 9 * 36e5 + k * 6e4).toISOString();
  const meta = (d, k) => ({ createdAt: ts(d, k), createdBy: 'local-user', changedAt: null, changedBy: null });

  const FIRST = ['Lotte', 'Bram', 'Sofie', 'Jeroen', 'Els', 'Pieter', 'Katrien', 'Tom', 'Nele', 'Wim', 'Hanne', 'Koen', 'Ine', 'Dries', 'Liesbeth', 'Stijn', 'Joke', 'Raf', 'Ellen', 'Bart', 'Marijke', 'Gert', 'Sarah', 'Jonas', 'Eva', 'Kristof', 'Leen', 'Maarten', 'Annelore', 'Filip'];
  const LAST = ['Daems', 'Claes', 'Wouters', 'Jacobs', 'Mertens', 'Willems', 'Goossens', 'Peeters', 'Maes', 'Vos', 'Hermans', 'Lenaerts', 'Vanhees', 'Bollen', 'Smeets', 'Reynders', 'Vranken', 'Vanderhoydonck-Bervoets'];
  const TYPES = ['Metaalwerken', 'Kunststoffen', 'Meubelmakerij', 'Verpakkingen', 'Machinebouw', 'Verlichting', 'Composieten', 'Speeltoestellen'];
  const JOBS = ['Zaakvoerder', 'Productieverantwoordelijke', 'R&D-manager', 'Aankoper', 'Technisch directeur', ''];
  const ACTIONS = ['gebeld, geen antwoord', 'gebeld, terugbellen volgende week', 'mail met cases gestuurd', 'gesprek bij de klant', 'langsgegaan op de werf', 'offerte gestuurd', 'offerte besproken', 'LinkedIn-bericht gestuurd'];
  const NOTES = [
    'We willen eerst iets kunnen vastnemen voor we 40 000 euro in een matrijs steken.',
    'Onze twee ingenieurs zitten vol met orders, aan herontwerp komen we niet toe.',
    'De vorige designer maakte mooie tekeningen, maar onze productie kon het niet maken.',
    'Klanten vragen wat er op het einde met ons product gebeurt en daar hebben we geen antwoord op.',
    'Ons restmateriaal belandt in de container en dat kost elk jaar meer.',
    'Een groot bureau vroeg 60 000 voor een haalbaarheidsstudie. Te zwaar om eerst te testen.',
    'Als er een traject met steun is, doen we mee. Anders wachten we nog een jaar.',
    ''
  ];

  const db = { companies: [], persons: [], history_entries: [], stages: [], stage_changes: [], vias: [], week_actions: [] };

  // Stages: the two fixed ones, two active middle stages and one middle stage archived halfway.
  const meeting = id(), quote = id(), intro = id();
  db.stages.push(
    { id: 'contact', kind: 'start', name: null, position: 0, ...meta(0) },
    { id: intro, kind: 'middle', name: 'Kennismaking', position: 1, ...meta(0) },
    { id: meeting, kind: 'middle', name: 'Gesprek', position: 2, ...meta(0) },
    { id: quote, kind: 'middle', name: 'Offerte', position: 3, ...meta(0) },
    { id: 'order', kind: 'end', name: null, position: 1000, ...meta(0) }
  );
  const archiveIntroOn = Math.max(1, Math.floor(T / 2));
  db.stage_changes.push({ id: id(), stageId: intro, happenedOn: M.iso(archiveIntroOn), change: 'archived', ...meta(archiveIntroOn) });

  const vias = ['Event', 'Doorverwijzing', 'Andere', 'Beurs Kortrijk'].map((name, i) => ({ id: id(), name, position: i + 1, archivedAt: null, ...meta(0) }));
  vias[3].archivedAt = ts(Math.max(0, T - 2));
  db.vias = vias;

  // Companies, including two with very long names.
  const companies = [];
  const company = name => { const c = { id: id(), name, phone: R() < .4 ? '011 ' + int(10, 99) + ' ' + int(10, 99) + ' ' + int(10, 99) : '', email: '', website: R() < .5 ? name.split(' ')[0].toLowerCase() + '.be' : '', note: R() < .3 ? pick(['Gezien op de beurs.', 'Maakt eigen producten, zoekt een ontwerper.', 'Juiste persoon vragen via de receptie.']) : '', archivedAt: null, archiveGroup: null, deletedAt: null, ...meta(0) }; db.companies.push(c); companies.push(c); return c; };
  for (let i = 0; i < 40; i++) company(pick(LAST) + ' ' + pick(TYPES));
  company('Ateliers et Constructions Métalliques Vandersmissen-Dewulf NV');
  company('Limburgse Coöperatieve Vereniging voor Duurzame Landbouwmechanisatie');
  // Two companies with the same name: names are not identifiers.
  const twinA = company('Peeters Metaalwerken'), twinB = company('Peeters Metaalwerken');
  twinA.website = 'peeters-metaal.be'; twinB.website = 'peetersmetaalwerken.be';

  const used = new Set();
  const personName = () => { let x; do x = pick(FIRST) + ' ' + pick(LAST); while (used.has(x)); used.add(x); return x; };
  const person = (companyId, d) => {
    const name = personName();
    const p = { id: id(), companyId, name, phone: R() < .7 ? '04' + int(70, 99) + ' ' + int(10, 99) + ' ' + int(10, 99) + ' ' + int(10, 99) : '', email: R() < .6 ? name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.') + '@voorbeeld.be' : '', jobTitle: pick(JOBS), archivedAt: null, archiveGroup: null, deletedAt: null, ...meta(d) };
    db.persons.push(p); return p;
  };
  const entry = (p, d, k, fields) => { const e = { id: id(), personId: p.id, action: '', note: '', stageId: null, amount: null, status: null, nextStep: '', nextStepOn: null, entryChannel: null, viaId: null, hook: '', deletedAt: null, ...meta(d, k), ...fields, happenedOn: M.iso(d) }; db.history_entries.push(e); return e; };

  // Contacts with a history: forward, back, skipping, sometimes inactive.
  const middle = [meeting, quote];
  for (let i = 0; i < 160; i++) {
    const d0 = int(0, T);
    const c = R() < .08 ? null : pick(companies);
    const p = person(c ? c.id : null, d0);
    const channel = pick(['hook', 'linkedin', 'cold', 'cold']);
    const asksVia = channel === 'hook';
    const next0 = R() < .6 ? { nextStep: pick(['Terugbellen', 'Mail met cases sturen', 'Juiste persoon vragen', '']), nextStepOn: M.iso(d0 + int(2, 9)) } : {};
    entry(p, d0, 0, { kind: 'first_contact', stageId: 'contact', entryChannel: channel, viaId: asksVia ? pick(vias.slice(0, 3)).id : null, hook: asksVia ? pick(['Samen op Swipe Right for Ecodesign', 'Doorverwezen door POM', 'Hun post over restmateriaal']) : '', note: R() < .3 ? pick(NOTES) : '', ...next0 });
    let d = d0, k = 1, current = 'contact';
    const steps = int(0, 5);
    for (let j = 0; j < steps; j++) {
      d = d + int(0, 3);
      if (d > T) break;
      const r = R();
      let stageId = null;
      if (r < .45) {
        // Forward one stage, or skip one, or go back (a returning customer), or the archived stage before it was archived.
        const order = d < archiveIntroOn && R() < .3 ? [intro, ...middle, 'order'] : [...middle, 'order'];
        const at = order.indexOf(current);
        stageId = R() < .15 && at > 0 ? order[at - 1] : order[Math.min(order.length - 1, at + (R() < .2 ? 2 : 1))];
        if (stageId === current) stageId = null;
      }
      const amount = stageId === 'order' ? int(10, 36) * 500 : null;
      const plan = stageId !== 'order' && R() < .5 ? { nextStep: pick(['Offerte opvolgen', 'Tweede gesprek bij klant', 'Terugbellen', '']), nextStepOn: M.iso(d + int(1, 8)) } : {};
      entry(p, d, k++, { kind: 'follow_up', action: R() < .75 ? pick(ACTIONS) : '', note: R() < .4 ? pick(NOTES) : '', stageId, amount, ...plan });
      if (stageId) current = stageId;
    }
    if (R() < .1) entry(p, Math.min(T, d + 1), k++, { kind: 'status', status: 'inactive' });
  }

  // Contact persons not yet contacted.
  companies.slice(0, 12).forEach(c => { for (let i = 0; i < int(1, 2); i++) person(c.id, int(0, T)); });

  // Bin: a history entry and a contact person, deleted a few days ago.
  const binned = db.history_entries.find(e => e.kind === 'follow_up');
  if (binned) binned.deletedAt = ts(Math.max(0, T - 3));
  const cp = db.persons.find(p => !db.history_entries.some(e => e.personId === p.id));
  if (cp) cp.deletedAt = ts(Math.max(0, T - 1));

  // Archive: one company with everyone at it, and one contact on its own.
  const archived = companies.find(c => db.persons.filter(p => p.companyId === c.id && !p.deletedAt).length >= 2);
  if (archived) {
    const g = id(), at = ts(Math.max(0, T - 2));
    archived.archivedAt = at; archived.archiveGroup = g;
    db.persons.filter(p => p.companyId === archived.id && !p.deletedAt).forEach(p => { p.archivedAt = at; p.archiveGroup = g; });
  }
  const loner = db.persons.find(p => !p.archivedAt && !p.deletedAt && db.history_entries.some(e => e.personId === p.id));
  if (loner) { loner.archivedAt = ts(Math.max(0, T - 1)); loner.archiveGroup = id(); }

  // Week actions: events as separate taps (+1, sometimes a −1 correction), a post in most weeks.
  for (let w = 1; w <= M.weekOf(T); w++) {
    const ws = M.iso(M.weekStart(w)), day = Math.max(0, M.weekStart(w));
    for (let i = 0; i < int(0, 3); i++) db.week_actions.push({ id: id(), weekStart: ws, kind: 'event', value: 1, ...meta(day, i) });
    if (R() < .2) db.week_actions.push({ id: id(), weekStart: ws, kind: 'event', value: -1, ...meta(day, 9) });
    if (R() < .7) db.week_actions.push({ id: id(), weekStart: ws, kind: 'post', value: 1, ...meta(day, 10) });
  }

  return db;
}

if (typeof module !== 'undefined') module.exports = makeTestData;
