export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fixed delay (number) or random integer in [min, max] (two-element array).
 * @param {number | [number, number] | null | undefined} delay
 */
export function resolveDelayMs(delay) {
  if (delay == null || delay === 0) return 0;

  if (Array.isArray(delay)) {
    if (delay.length !== 2) {
      throw new Error("Delay range must be [min_ms, max_ms]");
    }
    const [a, b] = delay.map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error("Delay range values must be numbers");
    }
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    if (max <= 0) return 0;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  const ms = Number(delay);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms;
}
