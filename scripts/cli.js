#!/usr/bin/env bun

import { fetchAll } from "./lib/fetch-data.js";
import { runSelections } from "./lib/select.js";
import { loadConfigAndApi } from "./lib/client.js";
import { TrafficLogger } from "./lib/traffic.js";
import { attachPlainTrafficLog } from "./lib/plain-log.js";
import { runWithTui } from "./lib/tui.jsx";

const USAGE = `\
UCAM Cloud CLI — see scripts/README.md

Usage:
  bun scripts/cli.js fetch     Download res.json + tmp/*.json
  bun scripts/cli.js select    Select sections from scripts/config.js
  bun scripts/cli.js all       fetch then select

Options:
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

async function runSelect(api, config, traffic) {
  return runSelections(api, config, traffic);
}

async function runAll(api, config, traffic) {
  const fetchResult = await runFetch(api, config, traffic);
  traffic?.log("Starting section selection...");
  const results = await runSelect(api, config, traffic);
  return { ...fetchResult, results };
}

/** @param {string} cmd @param {{ traffic?: import('./lib/traffic.js').TrafficLogger, config: object, api: import('./lib/api.js').UcamApi }} ctx */
async function executeCommand(cmd, { traffic, config, api }) {
  switch (cmd) {
    case "fetch":
      return runFetch(api, config, traffic);
    case "select":
      return runSelect(api, config, traffic);
    case "all": {
      const out = await runAll(api, config, traffic);
      exitCodeFromResults(out.results);
      return out;
    }
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

function printPlainResults(result) {
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
      const note = r.skipped ? " (already enrolled)" : r.dryRun ? " (dry run)" : "";
      console.log(`✓ ${label}: ${r.section ?? "ok"}${note}`);
    } else {
      console.log(`✗ ${label}: ${r.error}`);
    }
  }
  exitCodeFromResults(results);
}

async function main() {
  const argv = stripFlags(process.argv.slice(2));
  const cmd = argv[0];

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return;
  }

  if (!["fetch", "select", "all"].includes(cmd)) {
    console.error(`Unknown command: ${cmd}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (wantsTui(process.argv)) {
    const result = await runWithTui({
      command: cmd,
      run: ({ traffic, config, api }) =>
        executeCommand(cmd, { traffic, config, api }),
    });

    if (cmd === "select" || cmd === "all") {
      const results = Array.isArray(result) ? result : result?.results;
      exitCodeFromResults(results);
    }
    return;
  }

  const traffic = new TrafficLogger();
  attachPlainTrafficLog(traffic);
  const { config, api } = loadConfigAndApi({ traffic });

  try {
    const result = await executeCommand(cmd, { traffic, config, api });
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
