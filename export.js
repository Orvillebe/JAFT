/**
 * JAFT Exporter - the two exports.
 *
 * Responsibilities:
 *   - backup(): everything exactly as stored, including the bin and the archive, to restore from
 *   - analysis(): one file for an AI to find patterns in. One block per contact with its history
 *     in date order, readable labels, calculated values, and every planned next step with what
 *     became of it. Phone and e-mail are left out; person names are replaced by a number.
 *     Company names stay, so the AI can look up what kind of company it is.
 *
 * Archived records are not in the analysis: for the user they are deleted.
 */

const Exporter = (() => {
  const M = Model;

  async function backup() {
    return { app: 'JAFT', kind: 'backup', exportedAt: new Date().toISOString(), data: await DataService.exportAll() };
  }

  function analysis() {
    const T = M.today();
    const contacts = Store.contacts(), persons = Store.contactPersons();
    const ref = new Map();
    contacts.forEach((p, i) => ref.set(p.id, t('export.ref_contact', { n: i + 1 })));
    persons.forEach((p, i) => ref.set(p.id, t('export.ref_person', { n: i + 1 })));
    const date = d => d === null || d === undefined ? null : M.iso(d);
    const company = id => { const c = Store.company(id); return c ? c.name : null; };

    return {
      app: 'JAFT',
      kind: 'analysis',
      exportedOn: date(T),
      about: {
        planStart: JAFT_CONFIG.planStart,
        planEnd: JAFT_CONFIG.planEnd,
        weekStartsOn: t('weekdays').split(',')[JAFT_CONFIG.weekStartsOn],
        stagesInFunnelOrder: Store.stages().map(s => ({ stage: Store.stageLabel(s), archived: Store.stageArchived(s) })),
        entryChannels: Store.channels().map(c => Store.channelLabel(c.key)),
        notes: t('export.notes')
      },
      contacts: contacts.map(p => {
        const entries = Store.entriesOf(p.id);
        const outcomes = Object.fromEntries(M.nextStepOutcomes(entries, T).map(o => [o.entryId, o]));
        return {
          ref: ref.get(p.id),
          company: company(p.companyId),
          jobTitle: p.jobTitle || null,
          entryChannel: Store.channelLabel(p.entryChannel),
          via: p.via ? Store.viaLabel(p.via) : null,
          hook: p.hook || null,
          firstContactOn: date(p.firstContactDay),
          currentStage: Store.stageLabel(p.stageId),
          active: p.active,
          amount: p.amount,
          stageVisits: p.visits.map(v => ({ stage: Store.stageLabel(v.stageId), on: date(v.day), daysAfterFirstContact: v.day - p.firstContactDay })),
          history: entries.map(e => {
            const o = outcomes[e.id];
            return {
              on: e.happenedOn,
              enteredOn: e.createdAt ? e.createdAt.slice(0, 10) : null,
              kind: t('export.kind.' + e.kind),
              action: e.action || null,
              note: e.note || null,
              stage: e.stageId && e.kind === 'follow_up' ? Store.stageLabel(e.stageId) : null,
              amount: e.amount || null,
              status: e.status ? t('export.status.' + e.status) : null,
              nextStepPlanned: o ? {
                text: o.text || null,
                due: date(o.due),
                outcome: t('export.outcome.' + o.result),
                daysLate: o.daysLate || 0
              } : null
            };
          })
        };
      }),
      contactPersonsNotYetContacted: persons.filter(p => p.companyId).map(p => ({
        ref: ref.get(p.id), company: company(p.companyId), jobTitle: p.jobTitle || null, addedOn: p.createdAt ? p.createdAt.slice(0, 10) : null
      })),
      companies: Store.companies().map(c => ({
        name: c.name, website: c.website || null, note: c.note || null, addedOn: c.createdAt ? c.createdAt.slice(0, 10) : null,
        contacts: Store.contactsOf(c.id).length, contactPersonsNotYetContacted: Store.contactPersonsOf(c.id).length
      })),
      weeks: (() => {
        const cs = Store.counts(), out = [];
        for (let w = 1; w <= cs.currentWeek; w++) {
          const a = cs.actions(w);
          out.push({
            week: M.weekNumber(w), from: date(M.weekStart(w)), to: date(M.weekStart(w) + 6),
            newContacts: cs.newInWeek(w).length, events: a.events, linkedinPost: a.post,
            stages: Object.fromEntries(cs.weekStages(w).map(s => [Store.stageLabel(s), cs.visitsInWeek(s.id, w)]))
          });
        }
        return out;
      })()
    };
  }

  return { backup, analysis };
})();
