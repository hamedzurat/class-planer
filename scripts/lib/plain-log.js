import { formatPlainEntry } from "./traffic.js";

/** @param {import('./traffic.js').TrafficLogger} traffic */
export function attachPlainTrafficLog(traffic) {
  let lastStarted = 0;
  /** @type {Set<number>} */
  const completed = new Set();

  return traffic.subscribe(({ entries }) => {
    for (const entry of entries) {
      if (entry.id > lastStarted) {
        lastStarted = entry.id;
        console.log(`\n→ #${entry.id} ${formatPlainEntry(entry)}`);
        if (entry.requestBody) {
          console.log("  req:", JSON.stringify(entry.requestBody, null, 2));
        }
      }

      if (entry.state !== "pending" && !completed.has(entry.id)) {
        completed.add(entry.id);
        console.log(`← #${entry.id} ${formatPlainEntry(entry)}`);
        if (entry.error) {
          console.log("  err:", entry.error);
        } else if (
          entry.responseBody !== null &&
          entry.responseBody !== undefined
        ) {
          console.log("  res:", JSON.stringify(entry.responseBody, null, 2));
        }
      }
    }
  });
}
