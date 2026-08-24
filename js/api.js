/**
 * api.js
 * Frontend API client. This is the ONLY place that talks to the backend.
 * No AI provider is ever called directly from the browser — everything
 * goes through POST /api/analyse-values, which lives on the server and
 * holds the real API key.
 *
 * Loaded as a plain classic script (not an ES module) so the whole site,
 * including this file, can be opened directly from disk (file://) as well
 * as served over http(s) — see index.html for load order. Declarations
 * here (ApiError, analyseValues, cancelActiveRequest) are used directly by
 * js/app.js, which is loaded right after this file.
 */

// 75s: on free-tier hosts (e.g. Render's free plan) the backend can spin
// down after inactivity, and the first request after that can take
// 30-60s just to wake the server up before it even starts the AI call.
// 45s was cutting that off mid-wake, which is the #1 cause of "the result
// never shows up" — the request was quietly aborted client-side.
const DEFAULT_TIMEOUT_MS = 75000;

class ApiError extends Error{
  constructor(message, opts={}){
    super(message);
    this.name = 'ApiError';
    this.status = opts.status ?? null;
    this.code = opts.code ?? 'UNKNOWN';
  }
}

// Tracks the in-flight request so a second click can't fire a duplicate
// request — calling analyseValues again aborts whatever came before.
let activeController = null;

/**
 * @param {string} role - human-readable role label, e.g. "Business Owner"
 * @param {Array<{n:number, q:string, values:string[]}>} answers - all 13 answered questions
 * @returns {Promise<object>} the validated analysis result
 */
async function analyseValues(role, answers){
  if(activeController){
    activeController.abort();
  }
  const controller = new AbortController();
  activeController = controller;

  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try{
    const base = (window.CFF_CONFIG && window.CFF_CONFIG.API_BASE_URL) || '';
    const response = await fetch(base + '/api/analyse-values', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, answers }),
      signal: controller.signal
    });

    let data = null;
    try{
      data = await response.json();
    }catch(parseErr){
      // Response wasn't valid JSON at all.
      throw new ApiError('The server sent back something we could not read. Please try again.', { status: response.status, code: 'BAD_RESPONSE' });
    }

    if(!response.ok){
      const message = (data && data.error) || `The request failed (status ${response.status}).`;
      throw new ApiError(message, { status: response.status, code: (data && data.code) || 'SERVER_ERROR' });
    }

    if(!data || !data.result){
      throw new ApiError('The server response was missing the analysis. Please try again.', { code: 'EMPTY_RESULT' });
    }

    return data.result;
  }catch(err){
    if(err && err.name === 'AbortError'){
      throw new ApiError('The request took too long and was cancelled. Please try again.', { code: 'TIMEOUT' });
    }
    if(err instanceof ApiError) throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', { code: 'NETWORK' });
  }finally{
    clearTimeout(timer);
    if(activeController === controller){
      activeController = null;
    }
  }
}

/** Cancel any in-flight analysis request (e.g. user navigates away). */
function cancelActiveRequest(){
  if(activeController){
    activeController.abort();
    activeController = null;
  }
}
