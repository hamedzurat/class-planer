import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";

/** @param {unknown} value */
function prettyJson(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** @param {number} status */
function statusColor(status) {
  if (status === null) return "gray";
  if (status >= 200 && status < 300) return "green";
  if (status >= 400) return "red";
  return "yellow";
}

/** @param {string} method */
function methodColor(method) {
  if (method === "GET") return "cyan";
  if (method === "POST") return "yellow";
  if (method === "PUT") return "blue";
  if (method === "DELETE") return "red";
  return "white";
}

/** @param {string} text @param {number} width */
function truncate(text, width) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {object} props
 * @param {import('./traffic.js').TrafficLogger} props.traffic
 * @param {string} props.command
 */
export function NetworkTui({ traffic, command }) {
  const { exit } = useApp();
  const { rows: stdoutRows = 24, columns: stdoutColumns = 80 } = useWindowSize();

  const [state, setState] = useState(traffic.getState());
  const [selectedId, setSelectedId] = useState(0);
  const [listScroll, setListScroll] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [pane, setPane] = useState(/** @type {'list' | 'detail'} */ ("list"));
  const followLatest = useRef(true);

  useEffect(() => traffic.subscribe(setState), [traffic]);

  const entries = state.entries;
  const selected =
    entries.find((e) => e.id === selectedId) ?? entries[entries.length - 1];

  useEffect(() => {
    const last = entries[entries.length - 1];
    if (!last) return;
    const prev = entries[entries.length - 2];
    if (followLatest.current || !prev || selectedId === prev.id || selectedId === 0) {
      setSelectedId(last.id);
      setDetailScroll(0);
    }
  }, [entries.length]);

  const done = state.phase !== "running";
  const cols = stdoutColumns;
  const rows = stdoutRows;

  const statusRows = 1;
  const headerRows = 1;
  const footerRows = Math.min(
    6,
    Math.max(
      2,
      Math.min(state.logLines.length, 3) +
        (state.phase === "error" ? 1 : 0) +
        (Array.isArray(state.result)
          ? Math.min(state.result.length, 3)
          : state.result?.results
            ? Math.min(state.result.results.length, 2) + 1
            : state.result?.files
              ? 1
              : 0),
    ),
  );
  const listRows = clamp(
    Math.floor((rows - statusRows - headerRows - footerRows) * 0.32),
    6,
    Math.max(6, rows - statusRows - headerRows - footerRows - 8),
  );
  const detailRows = rows - statusRows - headerRows - footerRows - listRows;

  const listVisible = listRows - 2;
  const detailVisible = Math.max(4, detailRows - 2);

  const colId = 4;
  const colMethod = 6;
  const colStatus = 7;
  const colTime = 8;
  const colPath = Math.max(10, cols - colId - colMethod - colStatus - colTime - 4);

  useEffect(() => {
    const idx = entries.findIndex((e) => e.id === selectedId);
    if (idx < 0) return;
    setListScroll((scroll) => {
      if (idx < scroll) return idx;
      if (idx >= scroll + listVisible) return idx - listVisible + 1;
      return scroll;
    });
  }, [selectedId, entries, listVisible]);

  useInput((input, key) => {
    if (input === "q" && done) {
      exit();
      return;
    }

    if (pane === "list") {
      if (key.upArrow) {
        followLatest.current = false;
        const idx = entries.findIndex((e) => e.id === selectedId);
        if (idx > 0) {
          setSelectedId(entries[idx - 1].id);
          setDetailScroll(0);
        }
      }
      if (key.downArrow) {
        const idx = entries.findIndex((e) => e.id === selectedId);
        if (idx >= 0 && idx < entries.length - 1) {
          followLatest.current = idx + 2 >= entries.length;
          setSelectedId(entries[idx + 1].id);
          setDetailScroll(0);
        }
      }
      if (key.rightArrow || key.tab) setPane("detail");
    } else {
      if (key.leftArrow || key.tab) setPane("list");
      if (key.upArrow) setDetailScroll((s) => Math.max(0, s - 1));
      if (key.downArrow) setDetailScroll((s) => s + 1);
      if (key.pageUp) setDetailScroll((s) => Math.max(0, s - detailVisible));
      if (key.pageDown) setDetailScroll((s) => s + detailVisible);
    }
  });

  const detailLines = useMemo(() => {
    if (!selected) return ["Select a request to inspect headers and body."];

    const lines = [
      "── Request ──────────────────────────────────────",
      `${selected.method} ${selected.url}`,
      "",
      "Headers",
      ...Object.entries(selected.requestHeaders).map(([k, v]) => `  ${k}: ${v}`),
    ];

    if (selected.requestBody) {
      lines.push("", "Request body", ...prettyJson(selected.requestBody).split("\n"));
    }

    lines.push("", "── Response ─────────────────────────────────────");

    if (selected.state === "pending") {
      lines.push("(waiting…)");
    } else if (selected.error) {
      lines.push(`Error: ${selected.error}`);
    } else {
      lines.push(
        `HTTP ${selected.status ?? "?"} ${selected.statusText} · ${selected.durationMs ?? "?"}ms`,
        "",
        ...prettyJson(selected.responseBody).split("\n"),
      );
    }

    return lines;
  }, [selected]);

  const maxDetailScroll = Math.max(0, detailLines.length - detailVisible);
  const safeDetailScroll = clamp(detailScroll, 0, maxDetailScroll);
  const visibleDetail = detailLines.slice(
    safeDetailScroll,
    safeDetailScroll + detailVisible,
  );

  const visibleEntries = entries.slice(listScroll, listScroll + listVisible);

  const phaseColor =
    state.phase === "done" ? "green" : state.phase === "error" ? "red" : "cyan";

  const statusHint = done
    ? "q quit"
    : pane === "list"
      ? "↑↓ select · tab detail"
      : "↑↓ scroll · tab list";

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box width={cols} height={headerRows}>
        <Text bold color="blue">
          UCAM Network
        </Text>
        <Text dimColor> │ </Text>
        <Text bold>{command}</Text>
        <Text dimColor> │ </Text>
        <Text color={phaseColor}>{state.phase}</Text>
        <Text dimColor> │ {entries.length} req</Text>
        {selected ? (
          <>
            <Text dimColor> │ </Text>
            <Text dimColor>
              #{selected.id} {selected.method} {truncate(selected.path, Math.max(20, cols - 48))}
            </Text>
          </>
        ) : null}
      </Box>

      <Box
        flexDirection="column"
        width={cols}
        height={listRows}
        borderStyle="single"
        borderColor={pane === "list" ? "cyan" : "gray"}
        overflow="hidden"
      >
        <Box width={cols - 2} paddingX={1}>
          <Text bold dimColor>
            {truncate("Requests", cols - 2)}
          </Text>
        </Box>
        <Box width={cols - 2} paddingX={1}>
          <Text dimColor>
            {String("#").padEnd(colId)}
            {String("Method").padEnd(colMethod)}
            {String("Path").padEnd(colPath)}
            {String("Status").padEnd(colStatus)}
            Time
          </Text>
        </Box>
        <Box flexDirection="column" width={cols - 2} paddingX={1} overflow="hidden">
          {entries.length === 0 ? (
            <Text dimColor>Waiting for requests…</Text>
          ) : (
            visibleEntries.map((entry) => {
              const active = entry.id === selected?.id;
              const marker = active ? "▸" : " ";
              const statusLabel =
                entry.state === "pending"
                  ? "…"
                  : entry.error
                    ? "ERR"
                    : String(entry.status ?? "?");
              const timeLabel =
                entry.durationMs !== null ? `${entry.durationMs}ms` : "—";

              return (
                <Box key={entry.id} width={cols - 4}>
                  <Text inverse={active} wrap="truncate">
                    {marker}
                    {String(entry.id).padEnd(colId - 1)}
                    <Text color={methodColor(entry.method)}>
                      {entry.method.padEnd(colMethod)}
                    </Text>
                    {truncate(entry.path, colPath).padEnd(colPath)}
                    <Text color={statusColor(entry.status)}>
                      {statusLabel.padEnd(colStatus)}
                    </Text>
                    {timeLabel}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
      </Box>

      <Box
        flexDirection="column"
        width={cols}
        flexGrow={1}
        minHeight={6}
        borderStyle="single"
        borderColor={pane === "detail" ? "cyan" : "gray"}
        overflow="hidden"
      >
        <Box width={cols - 2} paddingX={1}>
          <Text bold>
            Detail {selected ? `#${selected.id}` : ""}
            <Text dimColor>
              {" "}
              {safeDetailScroll > 0
                ? `· line ${safeDetailScroll + 1}/${detailLines.length}`
                : ""}
            </Text>
          </Text>
        </Box>
        <Box flexDirection="column" width={cols - 2} paddingX={1} overflow="hidden">
          {visibleDetail.map((line, i) => {
            const isSection = line.startsWith("──");
            const isHeader = line === "Headers" || line === "Request body";
            return (
              <Text
                key={`${safeDetailScroll}-${i}`}
                wrap="truncate"
                bold={isSection}
                dimColor={isHeader}
                color={isSection ? "blue" : undefined}
              >
                {truncate(line, cols - 4)}
              </Text>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" width={cols} height={footerRows} overflow="hidden" paddingX={1}>
        {state.logLines.slice(-3).map((line, i) => (
          <Text key={`log-${i}`} dimColor wrap="truncate">
            {truncate(line, cols - 2)}
          </Text>
        ))}
        {state.phase === "error" && state.error ? (
          <Text color="red" wrap="truncate">
            Error: {truncate(state.error, cols - 10)}
          </Text>
        ) : null}
        {Array.isArray(state.result)
          ? state.result.slice(0, 3).map((r, i) => {
              const label = r.formalCode || r.courseCode || `#${i + 1}`;
              const note = r.skipped
                ? " (enrolled)"
                : r.dryRun
                  ? " (dry)"
                  : "";
              return r.ok ? (
                <Text key={label} color="green" wrap="truncate">
                  ✓ {label}: {r.section ?? "ok"}
                  {note}
                </Text>
              ) : (
                <Text key={label} color="red" wrap="truncate">
                  ✗ {label}: {r.error}
                </Text>
              );
            })
          : null}
        {state.result?.results
          ? state.result.results.slice(0, 2).map((r, i) => {
              const label = r.formalCode || r.courseCode || `#${i + 1}`;
              return (
                <Text key={label} color={r.ok ? "green" : "red"} wrap="truncate">
                  {r.ok ? "✓" : "✗"} {label}
                  {r.section ? `: ${r.section}` : r.error ? `: ${r.error}` : ""}
                </Text>
              );
            })
          : null}
        {state.result?.files && !state.result?.results ? (
          <Text color="green" wrap="truncate">
            Saved {state.result.files.length} files
          </Text>
        ) : null}
      </Box>

      <Box width={cols} height={statusRows}>
        <Text dimColor wrap="truncate">
          {statusHint.padEnd(Math.max(20, cols - 40))}
          {entries.length > listVisible
            ? `list ${listScroll + 1}-${Math.min(listScroll + listVisible, entries.length)}/${entries.length}`
            : ""}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * @param {object} opts
 * @param {string} opts.command
 * @param {(ctx: { traffic: import('./traffic.js').TrafficLogger, config: object, api: import('./api.js').UcamApi }) => Promise<unknown>} opts.run
 */
export async function runWithTui({ command, run }) {
  const { render } = await import("ink");
  const { TrafficLogger } = await import("./traffic.js");
  const { loadConfigAndApi } = await import("./client.js");

  const traffic = new TrafficLogger();
  let workError = null;

  const app = render(<NetworkTui traffic={traffic} command={command} />, {
    patchConsole: false,
    exitOnCtrlC: true,
    alternateScreen: true,
  });

  try {
    const { config, api } = loadConfigAndApi({ traffic });
    const result = await run({ traffic, config, api });
    traffic.setDone(result);
  } catch (err) {
    workError = err;
    traffic.setError(err instanceof Error ? err.message : String(err));
  }

  await app.waitUntilExit();
  app.unmount();

  if (workError) throw workError;
  return traffic.getState().result;
}
