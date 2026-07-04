import { authFromConfig, loadConfig } from "./config.js";
import { UcamApi, ensureAuth } from "./api.js";
import { apiOptionsFromConfig } from "./defaults.js";

export { loadConfig };

/** @param {{ traffic?: import('./traffic.js').TrafficLogger }} [opts] */
export function loadConfigAndApi(opts = {}) {
  const config = loadConfig();
  const auth = authFromConfig(config);
  const api = new UcamApi(
    apiOptionsFromConfig(config, auth, { traffic: opts.traffic ?? null }),
  );
  ensureAuth(api);
  return { config, api };
}
