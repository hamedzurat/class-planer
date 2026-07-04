/** @typedef {'pending' | 'done' | 'error'} TrafficEntryState */

/**
 * @typedef {object} TrafficEntry
 * @property {number} id
 * @property {string} method
 * @property {string} url
 * @property {string} path
 * @property {Record<string, string>} requestHeaders
 * @property {unknown} requestBody
 * @property {number | null} status
 * @property {string} statusText
 * @property {number | null} durationMs
 * @property {unknown} responseBody
 * @property {string | null} error
 * @property {TrafficEntryState} state
 * @property {number} startedAt
 */

/**
 * @typedef {object} TrafficState
 * @property {TrafficEntry[]} entries
 * @property {string[]} logLines
 * @property {'running' | 'done' | 'error'} phase
 * @property {string | null} error
 * @property {unknown} result
 */

export class TrafficLogger {
  /** @type {TrafficEntry[]} */
  #entries = [];
  /** @type {string[]} */
  #logLines = [];
  /** @type {Set<(state: TrafficState) => void>} */
  #listeners = new Set();
  #seq = 0;
  /** @type {'running' | 'done' | 'error'} */
  #phase = "running";
  /** @type {string | null} */
  #error = null;
  /** @type {unknown} */
  #result = null;

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.getState());
    return () => this.#listeners.delete(listener);
  }

  getState() {
    return {
      entries: this.#entries,
      logLines: this.#logLines,
      phase: this.#phase,
      error: this.#error,
      result: this.#result,
    };
  }

  /** @param {string} line */
  log(line) {
    this.#logLines.push(line);
    if (this.#logLines.length > 200) this.#logLines.shift();
    this.#notify();
  }

  /** @param {{ method: string, url: string, path: string, requestHeaders: Record<string, string>, requestBody: unknown }} req */
  begin(req) {
    const id = ++this.#seq;
    const entry = {
      id,
      method: req.method,
      url: req.url,
      path: req.path,
      requestHeaders: redactHeaders(req.requestHeaders),
      requestBody: redactBody(req.requestBody),
      status: null,
      statusText: "",
      durationMs: null,
      responseBody: null,
      error: null,
      state: /** @type {const} */ ("pending"),
      startedAt: Date.now(),
    };
    this.#entries.push(entry);
    this.#notify();
    return id;
  }

  /**
   * @param {number} id
   * @param {{ status?: number, statusText?: string, responseBody?: unknown, error?: string, durationMs?: number }} res
   */
  end(id, res) {
    const entry = this.#entries.find((e) => e.id === id);
    if (!entry) return;

    entry.state = res.error ? "error" : "done";
    entry.status = res.status ?? null;
    entry.statusText = res.statusText ?? "";
    entry.responseBody = redactBody(res.responseBody);
    entry.error = res.error ?? null;
    entry.durationMs = res.durationMs ?? null;
    this.#notify();
  }

  setDone(result) {
    this.#phase = "done";
    this.#result = result;
    this.#notify();
  }

  /** @param {string} message */
  setError(message) {
    this.#phase = "error";
    this.#error = message;
    this.#notify();
  }

  #notify() {
    const state = this.getState();
    for (const listener of this.#listeners) listener(state);
  }
}

/** @param {Record<string, string>} headers */
function redactHeaders(headers) {
  const out = { ...headers };
  if (out.Authorization) {
    const token = out.Authorization.replace(/^Bearer\s+/i, "");
    out.Authorization =
      token.length > 12
        ? `Bearer ${token.slice(0, 6)}…${token.slice(-4)}`
        : "Bearer [redacted]";
  }
  return out;
}

/** @param {unknown} body */
function redactBody(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body)) return body.map(redactBody);

  const out = { .../** @type {Record<string, unknown>} */ (body) };
  if (typeof out.refresh_token === "string") {
    const t = out.refresh_token;
    out.refresh_token =
      t.length > 12 ? `${t.slice(0, 6)}…${t.slice(-4)}` : "[redacted]";
  }
  if (typeof out.access_token === "string") {
    const t = out.access_token;
    out.access_token =
      t.length > 12 ? `${t.slice(0, 6)}…${t.slice(-4)}` : "[redacted]";
  }
  return out;
}

/** @param {TrafficEntry} entry */
export function formatPlainEntry(entry) {
  const status =
    entry.state === "pending"
      ? "…"
      : entry.error
        ? "ERR"
        : String(entry.status ?? "?");
  const ms =
    entry.durationMs !== null ? ` ${entry.durationMs}ms` : "";
  const path = entry.path.padEnd(42);
  return `${entry.method.padEnd(4)} ${path} ${status}${ms}`;
}
