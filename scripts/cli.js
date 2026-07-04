#!/usr/bin/env bun

import { fetchAll } from "./lib/fetch-data.js";
import { runSelections } from "./lib/select.js";
import { loadConfig, loadConfigAndApi } from "./lib/client.js";
import { TrafficLogger } from "./lib/traffic.js";
import { attachPlainTrafficLog } from "./lib/plain-log.js";
import { runWithTui } from "./lib/tui.jsx";
import {
  PICK_USAGE,
  parsePickArgs,
  selectBySectionId,
} from "./lib/select-by-id.js";

const USAGE = `\
UCAM Cloud CLI — see scripts/README.md

Usage (via just):
  just ucam-fetch          Download res.json + tmp/*.json
  just ucam-select         Select sections from scripts/config.js
  just ucam-pick           Pick one section (UUID or flags)
  just ucam-pick-section   Pick by formal code + letter
  just ucam-all            fetch then select
  just ucam-help           Show this help + pick usage

Options (append to any recipe):
  --no-tui    Plain log output (also NO_TUI=1)
`;

function wantsTui(argv) {
  if (argv.includes("--no-tui")) return false;
  if (process.env.NO_TUI) return false;
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function stripFlags(argv) {
  return argv.filter((a) => a !== "--no-tui");
}

/** @param {unknown} results */
function exitCodeFromResults(results) {
  if (Array.isArray(results) && results.some((r) => r && r.ok === false)) {
    process.exitCode = 1;
  }
}

async function runFetch(api, config, traffic) {
  traffic?.log("Fetching UCAM data...");
  const files = await fetchAll(api, config);
  traffic?.log(`Done — ${files.length} files saved`);
  return { files, summary: `${files.length} files` };
}

async function runPick(api, config, traffic, pickOpts) {
  const log = (msg) => (traffic ? traffic.log(msg) : console.log(msg));
  return selectBySectionId(api, config, { ...pickOpts, log });
}

async function runAll(api, config, traffic) {
  const fetchResult = await runFetch(api, config, traffic);
  traffic?.log("Starting section selection...");
  const results = await runSelect(api, config, traffic);
  return { ...fetchResult, results };
}

/** @param {string} cmd @param {{ traffic?: import('./lib/traffic.js').TrafficLogger, config: object, api: import('./lib/api.js').UcamApi, pickOpts?: ReturnType<typeof parsePickArgs> }} ctx */
async function executeCommand(cmd, { traffic, config, api, pickOpts }) {
  switch (cmd) {
    case "fetch":
      return runFetch(api, config, traffic);
    case "select":
      return runSelections(api, config, traffic);
    case "pick":
      return runPick(api, config, traffic, pickOpts);
    case "all": {
      const out = await runAll(api, config, traffic);
      exitCodeFromResults(out.results);
      return out;
    }
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

function printPickResult(result) {
  if (!result) return;
  if (result.ok) {
    const note = result.dryRun ? " (dry run — no request sent)" : "";
    console.log(
      `✓ ${result.formalCode ?? result.courseCode}: ${result.section}${note}`,
    );
    if (result.dryRun && result.payload) {
      console.log(`  POST /courses/sections/${result.courseCode}/select`);
      console.log(`  ${JSON.stringify(result.payload, null, 2)}`);
    }
    if (result.message) console.log(`  ${result.message}`);
  } else {
    console.log(`✗ ${result.error ?? "failed"}`);
    process.exitCode = 1;
  }
}

function printPlainResults(result) {
  if (result?.sectionId && !Array.isArray(result)) {
    printPickResult(result);
    return;
  }

  if (Array.isArray(result?.files)) {
    for (const f of result.files) console.log(`  → ${f}`);
    console.log(`Fetched ${result.files.length} files.\n`);
  }

  const results = Array.isArray(result)
    ? result
    : Array.isArray(result?.results)
      ? result.results
      : null;

  if (!results) {
    if (Array.isArray(result?.files)) {
      console.log(`Done (${result.files.length} files).`);
    }
    return;
  }

  for (const r of results) {
    const label = r.formalCode || r.courseCode;
    if (r.ok) {
      const note = r.skipped
        ? " (already enrolled)"
        : r.dryRun
          ? " (dry run)"
          : "";
      console.log(`✓ ${label}: ${r.section ?? "ok"}${note}`);
    } else {
      console.log(`✗ ${label}: ${r.error}`);
    }
  }
  exitCodeFromResults(results);
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const cmd = rawArgv[0];

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    console.log("\n" + PICK_USAGE);
    return;
  }

  if (cmd === "pick") {
    const pickOpts = parsePickArgs(rawArgv.slice(1));
    if (pickOpts.help) {
      console.log(PICK_USAGE);
      return;
    }
    if (
      !pickOpts.formalCode &&
      !pickOpts.sectionLetter &&
      !pickOpts.sectionRef
    ) {
      console.error(
        "Specify --formal-code + --section, CSE4326:H, or a list UUID.\n\n" +
          PICK_USAGE,
      );
      process.exitCode = 1;
      return;
    }

    const config = loadConfig();
    const needsApi = !pickOpts.dryRun || !pickOpts.localOnly;
    const useTui =
      needsApi && wantsTui(rawArgv) && !pickOpts.noTui && !pickOpts.dryRun;
    const label =
      pickOpts.formalCode && pickOpts.sectionLetter
        ? `pick ${pickOpts.formalCode}:${pickOpts.sectionLetter}`
        : pickOpts.sectionRef
          ? `pick ${pickOpts.sectionRef.slice(0, 8)}…`
          : "pick";

    if (useTui) {
      const result = await runWithTui({
        command: label,
        run: ({ traffic, config: cfg, api }) =>
          runPick(api, cfg, traffic, pickOpts),
      });
      if (!result?.ok) process.exitCode = 1;
      return;
    }

    try {
      if (needsApi) {
        const traffic = new TrafficLogger();
        attachPlainTrafficLog(traffic);
        const { api } = loadConfigAndApi({ traffic });
        printPickResult(await runPick(api, config, traffic, pickOpts));
      } else {
        printPickResult(await runPick(null, config, null, pickOpts));
      }
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
    return;
  }

  const argv = stripFlags(rawArgv);
  const mainCmd = argv[0];

  if (!["fetch", "select", "all"].includes(mainCmd)) {
    console.error(`Unknown command: ${mainCmd}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (wantsTui(process.argv)) {
    const result = await runWithTui({
      command: mainCmd,
      run: ({ traffic, config, api }) =>
        executeCommand(mainCmd, { traffic, config, api }),
    });

    if (mainCmd === "select" || mainCmd === "all") {
      const results = Array.isArray(result) ? result : result?.results;
      exitCodeFromResults(results);
    }
    return;
  }

  const traffic = new TrafficLogger();
  attachPlainTrafficLog(traffic);
  const { config, api } = loadConfigAndApi({ traffic });

  try {
    const result = await executeCommand(mainCmd, { traffic, config, api });
    printPlainResults(result);
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});
