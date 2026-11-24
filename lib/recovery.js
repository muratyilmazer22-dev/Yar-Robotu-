(function attachRecovery(root, factory) {
  const recovery = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = recovery;
  if (root) root.RaceRobotRecovery = recovery;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRecovery() {
  const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
  const MAX_RETRIES = 2;

  function emit(name, detail) {
    if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
    globalThis.dispatchEvent(new globalThis.CustomEvent(name, { detail }));
  }

  function requestPath(input) {
    const rawUrl = typeof input === "string" ? input : input?.url;
    if (!rawUrl) return "unknown";
    try {
      return new URL(rawUrl, globalThis.location?.href || "http://localhost").pathname;
    } catch {
      return "unknown";
    }
  }

  function createRecoveryFetch({ fetchImpl = globalThis.fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxRetries = MAX_RETRIES, baseDelayMs = 250 } = {}) {
    const retries = Math.max(0, Math.min(MAX_RETRIES, Number.isInteger(maxRetries) ? maxRetries : MAX_RETRIES));
    return async function recoveryFetch(input, init = {}) {
      const method = String(init.method || input?.method || "GET").toUpperCase();
      if (method !== "GET") return fetchImpl(input, init);

      const path = requestPath(input);
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await fetchImpl(input, init);
          if (!RETRYABLE_STATUSES.has(response.status)) {
            if (attempt > 0) emit("racerobot:recovery-succeeded", { path, attempts: attempt });
            return response;
          }
          if (attempt >= retries) {
            emit("racerobot:recovery-failed", { path, attempts: attempt, status: response.status });
            return response;
          }
          try { await response.body?.cancel(); } catch { /* A failed response body must not block retry. */ }
        } catch (error) {
          if (error?.name === "AbortError" || !(error instanceof TypeError)) throw error;
          if (attempt >= retries) {
            emit("racerobot:recovery-failed", { path, attempts: attempt, status: null });
            throw error;
          }
        }
        await wait(Math.min(2000, baseDelayMs * (2 ** attempt)));
      }
    };
  }

  return { createRecoveryFetch };
});
