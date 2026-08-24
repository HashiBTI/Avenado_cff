/**
 * storage.js
 * Safe localStorage wrapper for the CFF app.
 *
 * - Detects whether localStorage is actually usable (private browsing,
 *   disabled storage, storage full, etc. all fail safely).
 * - Wraps every read/write in try/catch so a corrupted or blocked store
 *   never crashes the app — it just falls back to an in-memory session.
 * - Carries a version number so future releases can migrate or discard
 *   old shapes instead of throwing on stale data.
 *
 * Loaded as a plain classic script (not an ES module) so the whole site,
 * including this file, can be opened directly from disk (file://) as well
 * as served over http(s) — see index.html for load order. Declarations
 * here (saveState, loadState, clearState, storageAvailable) are used
 * directly by js/app.js, which is loaded right after this file.
 */

const LEGACY_STORAGE_KEY = 'cff:app-state';
const STORAGE_VERSION = 2;

/*
 * Now that real accounts exist, two people can log in on the same browser.
 * Keying the saved state by user id stops User B from opening the app and
 * finding User A's answers already filled in.
 *
 * Empty namespace = the old shared key, used before anyone signs in.
 */
let storageNamespace = '';

function currentStorageKey(){
  return storageNamespace
    ? LEGACY_STORAGE_KEY + ':' + storageNamespace
    : LEGACY_STORAGE_KEY;
}

/**
 * Point storage at a specific user's slot. Call with the Supabase user id
 * right after login, and with null on logout.
 *
 * The first time a user is namespaced, any state saved under the old
 * shared key is moved across so early testers don't lose work.
 */
function setStorageNamespace(userId){
  storageNamespace = userId ? String(userId) : '';

  if(!storageAvailable || !storageNamespace) return;

  try{
    const namespaced = window.localStorage.getItem(currentStorageKey());
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if(!namespaced && legacy){
      window.localStorage.setItem(currentStorageKey(), legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  }catch(err){
    console.warn('CFF storage: namespace migration failed (%s)', err && err.name);
  }
}

function detectStorageAvailable(){
  try{
    const testKey = '__cff_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  }catch(err){
    return false;
  }
}

const storageAvailable = detectStorageAvailable();

/**
 * Persist app state. Returns true on success, false otherwise.
 * Never throws.
 */
function saveState(state){
  if(!storageAvailable) return false;
  try{
    const payload = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      state
    };
    window.localStorage.setItem(currentStorageKey(), JSON.stringify(payload));
    return true;
  }catch(err){
    // Likely quota exceeded — fail silently, app keeps working in memory.
    console.warn('CFF storage: save failed (%s)', err && err.name);
    return false;
  }
}

/**
 * Load previously saved app state, or null if none / incompatible / corrupt.
 * Never throws.
 */
function loadState(){
  if(!storageAvailable) return null;
  try{
    const raw = window.localStorage.getItem(currentStorageKey());
    if(!raw) return null;

    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== 'object') return null;

    if(parsed.version !== STORAGE_VERSION){
      // Shape changed since this was saved. In a future release this is
      // where a migration step would live. For now, discard safely
      // rather than risk feeding the app a shape it doesn't expect.
      console.warn('CFF storage: stored version %s != current %s — discarding', parsed.version, STORAGE_VERSION);
      return null;
    }

    return parsed.state || null;
  }catch(err){
    console.warn('CFF storage: load failed, resetting (%s)', err && err.name);
    return null;
  }
}

/** Permanently remove all saved app data. Never throws. */
function clearState(){
  if(!storageAvailable) return;
  try{
    window.localStorage.removeItem(currentStorageKey());
  }catch(err){
    console.warn('CFF storage: clear failed (%s)', err && err.name);
  }
}
