/**
 * JAFT Config - settings that change rarely and only on purpose.
 *
 * This is the single place for these defaults. Invalid values fall back to the default
 * and are logged in the console. Stages are not here: they are data, managed in Instellingen.
 */

const JAFT_CONFIG = (() => {
  const DEFAULTS = {
    // The addresses where the live app runs. Only there does the app use the real database
    // (Supabase). Everywhere else (localhost, the local network, a file) it uses local test data
    // in the browser, so testing can never touch the real database by accident.
    productionHosts: [],

    // Default first day of a week: 0 = Monday ... 3 = Thursday. Changeable in Instellingen.
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
  const SETTINGS = { productionHosts: ['orvillebe.github.io'] };

  const CHECKS = {
    productionHosts: v => Array.isArray(v) && v.every(h => typeof h === 'string'),
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
  // The data layer follows from where the app runs, never from a setting someone might forget.
  const host = typeof location !== 'undefined' ? location.hostname : '';
  cfg.backend = cfg.productionHosts.includes(host) ? 'supabase' : 'local';
  return Object.freeze(cfg);
})();

if (typeof module !== 'undefined') module.exports = JAFT_CONFIG;
