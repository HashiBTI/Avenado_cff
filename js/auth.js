/**
 * auth.js
 * Supabase Authentication layer for CFF.
 *
 * Everything auth-related lives here so js/app.js only ever deals with a
 * small, friendly API and never touches the Supabase SDK directly.
 *
 * Loaded as a plain classic script, AFTER /vendor/supabase.js (which
 * defines the global `supabase` object) and BEFORE js/app.js — see
 * index.html for the exact order.
 *
 * Security notes:
 * - The key used here is the PUBLISHABLE (anon) key. It is public by
 *   design; every Supabase browser app ships it. Data access is protected
 *   by Row Level Security policies in Postgres, not by hiding this value.
 * - The SECRET / service-role key and the AI provider keys stay on the
 *   server and are never referenced in this file.
 * - The session (access + refresh token) is persisted by the SDK so the
 *   user stays logged in across refreshes and browser restarts.
 */

/* ========================================================================
   CLIENT
   ======================================================================== */

let sbClient = null;
let authConfigError = null;

function initAuthClient(){
  if(sbClient) return sbClient;

  const cfg = window.CFF_CONFIG || {};

  if(typeof supabase === 'undefined' || !supabase || typeof supabase.createClient !== 'function'){
    authConfigError = 'The authentication library did not load. Please refresh the page.';
    return null;
  }

  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY){
    authConfigError = 'Sign in is not configured on this server yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to your .env file and restart the server.';
    return null;
  }

  try{
    sbClient = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        // Keeps the user logged in after a refresh or browser restart.
        persistSession: true,
        autoRefreshToken: true,
        // Lets Supabase pick up the tokens in the URL after the user
        // clicks a password-reset or email-confirmation link.
        detectSessionInUrl: true,
        storageKey: 'cff-auth'
      }
    });
    authConfigError = null;
  }catch(err){
    console.error('CFF auth: could not create Supabase client', err);
    authConfigError = 'Sign in could not be initialised. Please refresh the page.';
    sbClient = null;
  }

  return sbClient;
}

/** True when auth is usable. */
function authReady(){
  return Boolean(initAuthClient());
}

/** Human-readable reason auth is unavailable, or null. */
function authUnavailableReason(){
  initAuthClient();
  return authConfigError;
}

/* ========================================================================
   ERROR MESSAGES
   ======================================================================== */

/**
 * Supabase returns terse, developer-facing error strings. This maps the
 * common ones onto something a real person can act on.
 */
function friendlyAuthError(err){
  if(!err) return 'Something went wrong. Please try again.';

  const raw = String(err.message || err).toLowerCase();

  if(raw.includes('invalid login credentials')){
    return 'That email and password combination is not correct. Please check and try again.';
  }
  if(raw.includes('email not confirmed')){
    return 'Please confirm your email address first. Check your inbox for the confirmation link.';
  }
  if(raw.includes('user already registered') || raw.includes('already been registered')){
    return 'An account with this email already exists. Please log in instead, or use "Forgot password".';
  }
  if(raw.includes('password should be at least')){
    return 'Your password is too short. Please use at least 8 characters.';
  }
  if(raw.includes('for security purposes') || raw.includes('rate limit') || raw.includes('too many requests')){
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if(raw.includes('unable to validate email') || raw.includes('invalid email')){
    return 'That email address does not look valid. Please check it and try again.';
  }
  if(raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('load failed')){
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  if(raw.includes('same password')){
    return 'Your new password must be different from your old one.';
  }

  return err.message || 'Something went wrong. Please try again.';
}

/* ========================================================================
   AUTH ACTIONS
   ======================================================================== */

/**
 * Create a new account.
 *
 * Profile fields are passed as user metadata; a Postgres trigger
 * (see sql/phase1-auth.sql) copies them into public.profiles the moment
 * the auth user row is created, so the profile exists even if the user
 * confirms their email days later.
 *
 * @returns {Promise<{needsEmailConfirmation:boolean, user:object|null}>}
 */
async function authSignUp({ name, email, phone, password, role, company, jobTitle }){
  const client = initAuthClient();
  if(!client) throw new Error(authConfigError);

  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        full_name: name.trim(),
        phone: phone.trim(),
        profile_type: role || 'visitor',
        company: (company || '').trim(),
        job_title: (jobTitle || '').trim()
      },
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  if(error) throw new Error(friendlyAuthError(error));

  // When "Confirm email" is ON in Supabase, signUp returns a user but no
  // session — the user must click the emailed link before they can log in.
  return {
    needsEmailConfirmation: !data.session,
    user: data.user || null
  };
}

/** Log in with email + password. Resolves with the session. */
async function authSignIn({ email, password }){
  const client = initAuthClient();
  if(!client) throw new Error(authConfigError);

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password
  });

  if(error) throw new Error(friendlyAuthError(error));
  return data.session;
}

/**
 * Send a password-reset email.
 *
 * Always resolves, even for an unknown address — telling a stranger
 * whether an email is registered leaks who your users are.
 */
async function authRequestPasswordReset(email){
  const client = initAuthClient();
  if(!client) throw new Error(authConfigError);

  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin + window.location.pathname
  });

  // Rate limiting is the one error worth surfacing — otherwise stay quiet.
  if(error && String(error.message || '').toLowerCase().includes('security purposes')){
    throw new Error(friendlyAuthError(error));
  }
  return true;
}

/** Set a new password. Only works while a recovery session is active. */
async function authUpdatePassword(newPassword){
  const client = initAuthClient();
  if(!client) throw new Error(authConfigError);

  const { error } = await client.auth.updateUser({ password: newPassword });
  if(error) throw new Error(friendlyAuthError(error));
  return true;
}

/** Log out and clear the stored session. */
async function authSignOut(){
  const client = initAuthClient();
  if(!client) return;
  try{
    await client.auth.signOut();
  }catch(err){
    console.warn('CFF auth: sign out failed', err);
  }
}

/** Current session, or null. Reads from storage — no network round trip. */
async function authGetSession(){
  const client = initAuthClient();
  if(!client) return null;
  try{
    const { data } = await client.auth.getSession();
    return data.session || null;
  }catch(err){
    console.warn('CFF auth: could not read session', err);
    return null;
  }
}

/** The signed-in user object, or null. */
async function authGetUser(){
  const session = await authGetSession();
  return session ? session.user : null;
}

/**
 * The current access token — needed later (Phase 2+) to call our own
 * backend as the authenticated user.
 */
async function authGetAccessToken(){
  const session = await authGetSession();
  return session ? session.access_token : null;
}

/* ========================================================================
   PROFILE
   ======================================================================== */

/**
 * Read the signed-in user's profile row.
 * Falls back to auth metadata if the row is missing (e.g. the SQL trigger
 * has not been installed yet) so the app still works.
 */
async function authGetProfile(){
  const client = initAuthClient();
  if(!client) return null;

  const user = await authGetUser();
  if(!user) return null;

  const meta = user.user_metadata || {};
  const fallback = {
    id: user.id,
    name: meta.full_name || '',
    email: user.email || '',
    phone: meta.phone || '',
    role: meta.profile_type || 'visitor',
    company: meta.company || '',
    jobTitle: meta.job_title || ''
  };

  try{
    const { data, error } = await client
      .from('profiles')
      .select('id, full_name, email, phone, profile_type, company, job_title')
      .eq('id', user.id)
      .maybeSingle();

    if(error || !data){
      if(error) console.warn('CFF auth: profile lookup failed, using metadata', error.message);
      return fallback;
    }

    return {
      id: data.id,
      name: data.full_name || fallback.name,
      email: data.email || fallback.email,
      phone: data.phone || fallback.phone,
      role: data.profile_type || fallback.role,
      company: data.company || fallback.company,
      jobTitle: data.job_title || fallback.jobTitle
    };
  }catch(err){
    console.warn('CFF auth: profile lookup threw, using metadata', err);
    return fallback;
  }
}

/* ========================================================================
   AUTH STATE CHANGES
   ======================================================================== */

/**
 * Subscribe to auth events. `handler(event, session)`.
 * Used by app.js to react to PASSWORD_RECOVERY and to logouts that happen
 * in another browser tab.
 */
function onAuthStateChange(handler){
  const client = initAuthClient();
  if(!client) return () => {};

  const { data } = client.auth.onAuthStateChange((event, session) => {
    try{
      handler(event, session);
    }catch(err){
      console.error('CFF auth: state change handler failed', err);
    }
  });

  return () => {
    try{ data.subscription.unsubscribe(); }catch(_){}
  };
}

/* ========================================================================
   VALIDATION
   ======================================================================== */

/** Returns an error string, or '' when the password is acceptable. */
function passwordProblem(password){
  if(!password || password.length < 8){
    return 'Password must be at least 8 characters.';
  }
  if(!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)){
    return 'Password must include at least one letter and one number.';
  }
  return '';
}
