import { authFromConfig, loadConfig } from "./config.js";
import { UcamApi, ensureAuth } from "./api.js";

export { loadConfig };

/** @param {{ traffic?: import('./traffic.js').TrafficLogger }} [opts] */
export function loadConfigAndApi(opts = {}) {
  const config = loadConfig();
  const auth = authFromConfig(config);
  const api = new UcamApi({
    apiBase: config.api_base,
    origin: config.origin,
    referer: config.referer,
    userAgent: auth.userAgent,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    traffic: opts.traffic ?? null,
  });
  ensureAuth(api);
  return { config, api };
}
