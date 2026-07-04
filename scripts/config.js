/**
 * UCAM Cloud CLI configuration
 *
 * Edit this file directly. Do not commit real tokens to git.
 *
 * Tokens: log in at https://ucamcloud.uiu.ac.bd → DevTools → Application →
 *         Local Storage → copy ucam-access-token and ucam-refresh-token.
 *
 * Env overrides (set in .env): UCAM_ACCESS_TOKEN, UCAM_REFRESH_TOKEN, UCAM_USER_AGENT
 *
 * See scripts/README.md for usage and scripts/security.md for architecture & security.
 */

/** @type {const} */
export default {
  // Backend API (from UCAM frontend bundle — changes on redeploy)
  api_base: "https://lxr6c7qhl1.execute-api.ap-southeast-1.amazonaws.com/v3",

  // Sent on every request; should match a real browser session
  origin: "https://ucamcloud.uiu.ac.bd",
  referer: "https://ucamcloud.uiu.ac.bd/",

  // Use a normal browser UA — bot detection logs this on section selects.
  // Copy from DevTools → Network → any request → Request Headers → user-agent
  user_agent:
    "Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0",

  // Tokens are loaded from .env (UCAM_ACCESS_TOKEN / UCAM_REFRESH_TOKEN).
  // Leave these empty — they are only a fallback if env vars are not set.
  auth: {
    access_token: "",
    refresh_token: "",
  },

  // Your department code (CSE = 011)
  department: "011",

  output: {
    tmp_dir: "tmp",
    sections_file: "res.json",
  },

  select: {
    // true = skip courses that already have a section (no change/re-select)
    skip_if_enrolled: true,

    // false = enforce the real selection window (set true only for dry-run/testing)
    skip_time_check: false,

    // Poll until selection window opens (use before official start time)
    wait_until_open: true,
    poll_interval_ms: 2000,
    max_wait_ms: 600_000,

    // Pause between courses — number or [min, max] for random ms each gap
    min_delay_ms: [1200, 2200],

    // Retries per course on transient failure
    retry_on_failure: 2,
    retry_delay_ms: 800,

    // false = actually POST selections (set true to preview only)
    dry_run: false,

    // true = POST /courses/register after successful selects
    register_after: false,
  },

  // formal_code + section letter(s). First available letter in each list wins.
  selections: [
    { formal_code: "CSE 4326", sections: ["F", "H", "G"] },
    { formal_code: "CSE 4509", sections: ["F", "H"] },
    { formal_code: "CSE 4325", sections: ["H", "B", "D", "F"] },
    { formal_code: "CSE 4510", sections: ["D", "F", "G", "C"] },
    { formal_code: "CSE 4327", sections: ["A"] },
  ],
};
