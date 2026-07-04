import path from "node:path";
import config from "../config.js";

const ROOT = path.resolve(import.meta.dir, "../..");

export function loadConfig() {
  return config;
}

export function resolveOutputPaths(cfg) {
  const tmpDir = path.resolve(ROOT, cfg.output?.tmp_dir ?? "tmp");
  const sectionsFile = path.resolve(
    ROOT,
    cfg.output?.sections_file ?? "res.json",
  );
  return { tmpDir, sectionsFile };
}

export function authFromConfig(cfg) {
  const auth = cfg.auth ?? {};
  return {
    accessToken:
      process.env.UCAM_ACCESS_TOKEN?.trim() || auth.access_token?.trim() || "",
    refreshToken:
      process.env.UCAM_REFRESH_TOKEN?.trim() ||
      auth.refresh_token?.trim() ||
      "",
    userAgent:
      process.env.UCAM_USER_AGENT?.trim() || cfg.user_agent?.trim() || "",
  };
}
