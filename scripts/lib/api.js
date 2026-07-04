export class UcamApi {
  #base;
  #origin;
  #referer;
  #userAgent;
  #accessToken;
  #refreshToken;
  #refreshing = null;
  /** @type {import('./traffic.js').TrafficLogger | null} */
  #traffic;

  constructor(options) {
    this.#base = options.apiBase.replace(/\/$/, "");
    this.#origin = options.origin;
    this.#referer = options.referer;
    this.#userAgent = options.userAgent || "";
    this.#accessToken = options.accessToken || "";
    this.#refreshToken = options.refreshToken || "";
    this.#traffic = options.traffic ?? null;
  }

  get accessToken() {
    return this.#accessToken;
  }

  get refreshToken() {
    return this.#refreshToken;
  }

  #headers({ json = false, auth = true } = {}) {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("Origin", this.#origin);
    headers.set("Referer", this.#referer);
    if (this.#userAgent) headers.set("User-Agent", this.#userAgent);
    if (json) headers.set("Content-Type", "application/json");
    if (auth && this.#accessToken) {
      headers.set("Authorization", `Bearer ${this.#accessToken}`);
    }
    return headers;
  }

  async refresh() {
    if (!this.#refreshToken) throw new Error("No refresh token");
    if (this.#refreshing) return this.#refreshing;

    this.#refreshing = (async () => {
      const { json } = await this.#executeFetch("/auth/refresh", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ refresh_token: this.#refreshToken }),
      });

      if (json?.status !== "success") {
        throw new Error(json?.message || "Refresh failed");
      }
      this.#accessToken = json.data.access_token;
      if (json.data.refresh_token) {
        this.#refreshToken = json.data.refresh_token;
      }
      return json.data;
    })();

    try {
      return await this.#refreshing;
    } finally {
      this.#refreshing = null;
    }
  }

  getPublicConfig() {
    return this.get("/system/public-config", { auth: false });
  }

  getConfig() {
    return this.get("/system/configurations");
  }

  getMe() {
    return this.get("/users/me");
  }

  getEligibility() {
    return this.get("/users/me/eligibility");
  }

  getPreadviceCourses() {
    return this.get("/users/me/preadvice-courses");
  }

  getAllSections(department) {
    return this.get(`/courses/sections?department=${department}`);
  }

  getCourseSections(code) {
    return this.get(`/courses/sections/${encodeURIComponent(code)}`);
  }

  selectSection(code, payload) {
    return this.post(
      `/courses/sections/${encodeURIComponent(code)}/select`,
      payload,
    );
  }

  register() {
    return this.post("/courses/register", {});
  }

  get(path, opts = {}) {
    return this.#request(path, { ...opts, method: "GET" });
  }

  post(path, body, opts = {}) {
    return this.#request(path, {
      ...opts,
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
  }

  async #request(path, options) {
    let { res, json } = await this.#executeFetch(path, options);

    const needsAuth = options.auth !== false;
    if (needsAuth && this.#refreshToken && shouldRefresh(res)) {
      await this.refresh();
      ({ res, json } = await this.#executeFetch(path, options));
    }

    if (typeof json !== "object" || json === null) {
      throw new Error(`Invalid JSON response (HTTP ${res.status})`);
    }
    if (json.status !== "success") {
      const err = new Error(json.message || `Request failed on ${path}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async #executeFetch(path, options) {
    const method = options.method ?? "GET";
    const url = `${this.#base}${path}`;
    const needsAuth = options.auth !== false;
    const headers = this.#headers({
      json: Boolean(options.body),
      auth: needsAuth,
    });
    const requestHeaders = Object.fromEntries(headers.entries());

    let requestBody = null;
    if (options.body) {
      try {
        requestBody = JSON.parse(options.body);
      } catch {
        requestBody = options.body;
      }
    }

    const trafficId = this.#traffic?.begin({
      method,
      url,
      path,
      requestHeaders,
      requestBody,
    });

    const started = performance.now();

    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers,
        body: options.body,
      });

      const raw = await res.text();
      let json = null;
      if (raw) {
        try {
          json = JSON.parse(raw);
        } catch {
          json = raw;
        }
      }

      this.#traffic?.end(trafficId, {
        status: res.status,
        statusText: res.statusText,
        responseBody: json,
        durationMs: Math.round(performance.now() - started),
      });

      return { res, json };
    } catch (err) {
      this.#traffic?.end(trafficId, {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - started),
      });
      throw err;
    }
  }
}

function shouldRefresh(res) {
  return res.status === 401 || res.status === 403;
}

export function ensureAuth(api) {
  if (!api.accessToken) {
    throw new Error(
      "Set auth.access_token in scripts/config.js (refresh_token recommended). " +
        "Copy from browser localStorage: ucam-access-token, ucam-refresh-token.",
    );
  }
}
