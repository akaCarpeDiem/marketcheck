/**
 * Bound client fetches so a hung upstream cannot leave the dashboard
 * stuck on "Quotes loading…" forever.
 */
export const DEFAULT_FETCH_MS = 15_000;
export const AUTH_FETCH_MS = 8_000;
export const SEARCH_FETCH_MS = 10_000;

/** AbortSignal that fires after `ms`, optionally also when `external` aborts. */
export function fetchSignal(ms = DEFAULT_FETCH_MS, external?: AbortSignal): AbortSignal {
  const timed =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ms)
      : (() => {
          const c = new AbortController();
          setTimeout(() => c.abort(), ms);
          return c.signal;
        })();
  if (!external) return timed;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timed, external]);
  }
  if (external.aborted) return external;
  const c = new AbortController();
  const onAbort = () => c.abort();
  timed.addEventListener('abort', onAbort, { once: true });
  external.addEventListener('abort', onAbort, { once: true });
  return c.signal;
}
