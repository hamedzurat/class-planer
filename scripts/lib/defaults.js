export const DEFAULT_API_BASE =
  "https://lxr6c7qhl1.execute-api.ap-southeast-1.amazonaws.com/v3";
export const DEFAULT_ORIGIN = "https://ucamcloud.uiu.ac.bd";
export const DEFAULT_REFERER = "https://ucamcloud.uiu.ac.bd/";

export function apiOptionsFromConfig(config, auth, extra = {}) {
  return {
    apiBase: config.api_base ?? DEFAULT_API_BASE,
    origin: config.origin ?? DEFAULT_ORIGIN,
    referer: config.referer ?? DEFAULT_REFERER,
    userAgent: auth.userAgent || config.user_agent || "",
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    ...extra,
  };
}
