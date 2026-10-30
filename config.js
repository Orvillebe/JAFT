/**
 * JAFT Config - settings that change rarely and only on purpose.
 *
 * This is the single place for these defaults. Invalid values fall back to the default
 * and are logged in the console. Stages are not here: they are data, managed in Instellingen.
 */

const JAFT_CONFIG = (() => {
  const DEFAULTS = {
    // Which data layer to use: 'local' (this browser only, for testing) or 'supabase'.
    // Switch to 'supabase' once the JAFT Supabase project exists (see README).
    backend: 'local',

    // First day of the 90-day plan. Week numbers (week 1, 2, ...) count from here.
    planStart: '2026-10-19',

    // Last day of the plan: 90 days plus 2 weeks of Christmas leave.
    // The month calendar in the overview runs up to this month.
    planEnd: '2027-01-31',

    // First day of a week: 0 = Monday ... 3 = Thursday.
    // Thursday, because Wednesday ends with the meeting and the planning:
    // the week that closes then is complete and comparable with the previous one.
    weekStartsOn: 3,

    // How many contacts or companies a list shows before "Toon alle" appears.
    listLength: 12,

    // Days an item stays in the bin before it is removed for good.
    binDays: 30,

    // How a contact came in. Fixed for now; the key is stored, the label comes from the
    // translation file (channel.<key>). asksVia: the form asks for via and the hook text.
    // Kept as one list so it can later become a table managed in Instellingen (docs/design.md).
    entryChannels: [
      { key: 'hook', asksVia: true },
      { key: 'linkedin', asksVia: false },
      { key: 'cold', asksVia: false }
    ],

    // Through what a hook came. Fixed for now, in the same way as the entry channels:
    // the key is stored, the label comes from the translation file (via.<key>).
    viaOptions: ['event', 'referral', 'other']
  };

  // Change values here. Leave a key out to use the default.
  const SETTINGS = { backend: 'supabase' };

  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v));
  const CHECKS = {
    backend: v => v === 'local' || v === 'supabase',
    planStart: isDate,
    planEnd: isDate,
    weekStartsOn: v => Number.isInteger(v) && v >= 0 && v <= 6,
    listLength: v => Number.isInteger(v) && v > 0,
    binDays: v => Number.isInteger(v) && v > 0,
    entryChannels: v => Array.isArray(v) && v.length > 0 && v.every(c => c && typeof c.key === 'string'),
    viaOptions: v => Array.isArray(v) && v.every(k => typeof k === 'string')
  };

  const cfg = { ...DEFAULTS };
  for (const [k, v] of Object.entries(SETTINGS)) {
    if (CHECKS[k] && CHECKS[k](v)) cfg[k] = v;
    else console.warn(`JAFT config: invalid value for ${k}, default used`, v);
  }
  if (cfg.planEnd < cfg.planStart) {
    console.warn('JAFT config: planEnd is before planStart, defaults used');
    cfg.planStart = DEFAULTS.planStart; cfg.planEnd = DEFAULTS.planEnd;
  }
  return Object.freeze(cfg);
})();

if (typeof module !== 'undefined') module.exports = JAFT_CONFIG;
