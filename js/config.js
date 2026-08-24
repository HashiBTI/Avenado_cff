/**
 * config.js
 * Single place that decides where the browser sends API requests and how
 * it reaches Supabase.
 *
 * ─────────────────────────────────────────────────────────────────────
 * IMPORTANT: when the site is served by server/server.js (`npm start`),
 * this file is NOT used. The server generates /js/config.js at runtime
 * from your .env values so that the Supabase URL and publishable key
 * never have to be committed to the repository.
 *
 * This on-disk copy is only the fallback for opening index.html directly
 * from disk (file://) or hosting the folder on a plain static host. In
 * that case, fill in the two Supabase values below by hand.
 * ─────────────────────────────────────────────────────────────────────
 *
 * API_BASE_URL
 * - Served by server/server.js: leave as '' — requests go to relative
 *   paths like '/api/chat', resolved against the same origin.
 * - Inside the native app shell (Capacitor), point it at your deployed
 *   backend, e.g. 'https://cff.example.com'.
 *
 * SUPABASE_ANON_KEY
 * - This is the PUBLISHABLE (anon) key and is public by design — every
 *   Supabase browser app ships it. Access is controlled by Row Level
 *   Security policies in the database, not by hiding this value.
 * - NEVER put the secret / service-role key here. That one belongs in
 *   .env on the server only.
 *
 * Loaded as a classic script, before vendor/supabase.js, storage.js,
 * auth.js, api.js, app.js and ai-widget.js, so window.CFF_CONFIG is
 * already defined by the time they run.
 */
window.CFF_CONFIG = {
  API_BASE_URL: '',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
