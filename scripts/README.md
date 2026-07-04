# UCAM Cloud CLI

Fetch section data and run section selection against [UCAM Cloud](https://ucamcloud.uiu.ac.bd).

## Setup

1. Install [Bun](https://bun.sh).
2. Edit **`scripts/config.js`**:
   - Paste `access_token` and `refresh_token` from browser localStorage (`ucam-access-token`, `ucam-refresh-token`).
   - Set `user_agent` to your browser’s UA (DevTools → Network → any request → `user-agent` header).
   - Configure `selections` for your courses.
3. Do **not** commit real tokens.

## Commands

```bash
bun scripts/cli.js fetch    # download res.json + tmp/*.json
bun scripts/cli.js select   # select sections per config
bun scripts/cli.js all      # fetch then select
bun scripts/cli.js help
```

Via just:

```bash
just ucam-fetch
just ucam-select
```

## Network TUI

In a real terminal (TTY), commands show a **network-tab style UI** — every HTTP request and response, like DevTools:

- **Request list** — method, path, status, duration (color-coded)
- **Detail panel** — full request headers/body and response JSON
- **↑/↓** — select request · **Tab** — focus detail panel · **↑/↓** in detail to scroll · **q** — quit when done

Uses the terminal alternate screen (full viewport). Disable with `--no-tui`.

Plain text mode (pipes, CI, or `--no-tui` / `NO_TUI=1`):

```bash
bun scripts/cli.js fetch --no-tui
NO_TUI=1 bun scripts/cli.js select
```

Tokens in headers and bodies are redacted in the log.

## Getting tokens

1. Log in at https://ucamcloud.uiu.ac.bd (Turnstile runs in the browser).
2. Open DevTools → **Application** → **Local Storage** → site origin.
3. Copy `ucam-access-token` → `auth.access_token`
4. Copy `ucam-refresh-token` → `auth.refresh_token`

Tokens expire (~2 h access, ~1 day refresh). The CLI auto-refreshes on 401 if `refresh_token` is set.

**Env overrides** (optional):

```bash
export UCAM_ACCESS_TOKEN="..."
export UCAM_REFRESH_TOKEN="..."
export UCAM_USER_AGENT="Mozilla/5.0 ..."
```

## Config (`scripts/config.js`)

All options are documented inline. Key fields:

| Field                                 | Purpose                              |
| ------------------------------------- | ------------------------------------ |
| `auth.access_token` / `refresh_token` | Session tokens                       |
| `user_agent`                          | Browser User-Agent string            |
| `department`                          | e.g. `"011"` for CSE                 |
| `selections`                          | Courses and preferred sections       |
| `select.dry_run`                      | `true` = preview only, no POST       |
| `select.skip_if_enrolled`             | Skip if course already has a section |
| `select.skip_time_check`              | Skip client window/time checks       |
| `select.wait_until_open`              | Poll until selection window opens    |
| `select.min_delay_ms`                 | Fixed ms or `[min, max]` random gap  |
| `select.register_after`               | Run final registration after selects |

### Selections

```js
selections: [
  { formal_code: "CSE 4325", sections: ["B", "C", "A"] },
  { formal_code: "CSE 4326", sections: ["A"] },
],
```

- `formal_code` — e.g. `"CSE 4325"`
- `sections` — section letters, tried in order; first with free seats wins

### Timing options

```js
select: {
  skip_if_enrolled: true,       // skip when API shows is_enrolled (default)
  skip_time_check: false,       // true = ignore window open/close checks locally
  wait_until_open: true,        // poll until window opens (ignored if skip_time_check)
  min_delay_ms: 1500,           // fixed pause between courses
  min_delay_ms: [1200, 2200],   // or random integer in range each gap
}
```

`skip_if_enrolled` checks `is_enrolled` on the course detail **before** waiting or selecting. Duplicate entries for the same course in one run are skipped too. Set `false` only if you intentionally want to change section.

`skip_time_check` only bypasses **client-side** checks (`isSelectionOpen`). The API may still reject requests outside the official window.

## What `fetch` downloads

| Output              | Source                                |
| ------------------- | ------------------------------------- |
| `res.json`          | All dept sections (for class planner) |
| `tmp/pub.json`      | Public portal config                  |
| `tmp/conf.json`     | Selection windows                     |
| `tmp/features.json` | Your profile                          |
| `tmp/elig.json`     | Eligibility                           |
| `tmp/preadv.json`   | Pre-advised courses                   |
| `tmp/1306.json`, …  | Per-course section detail             |

Then run the class planner: `bun run main.js` or `just`.

## Typical workflow

1. `fetch` before selection opens — inspect `res.json` / `tmp/*`.
2. Set `select.dry_run: true`, run `select` — verify matching.
3. Set `select.wait_until_open: true` if running before the window.
4. Set `dry_run: false`, run `select` when ready.
5. Optionally `select.register_after: true` for final registration.

## Security notes

See **`scripts/security.md`** for architecture, auth, and bot-detection details.

Automating registration may violate UIU policy. Use at your own risk.
