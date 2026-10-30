/**
 * JAFT Data Service - picks the data layer set in config.js.
 *
 * Both implementations offer the same functions:
 *   needsLogin, signIn, signOut, getSession
 *   loadAll, loadHidden
 *   insert, update, remove
 *   createContact, archiveCompany, restoreGroup, purgeBin, exportAll
 *   schemaVersion, saveSetting
 * The rest of the app only talks to DataService, never to Supabase or localStorage directly.
 */

const DataService = JAFT_CONFIG.backend === 'supabase' ? createSupabaseData() : createLocalData();
