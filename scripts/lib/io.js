import path from "node:path";

/**
 * Returns the numeric prefix before the first hyphen in a course code.
 * e.g. "1306-1-1" → "1306"
 * @param {string} courseCode - expected format: "<number>-<major>-<version>"
 */
export function courseFileSlug(courseCode) {
  const slug = courseCode.split("-")[0];
  if (!slug) throw new Error(`Invalid course code (no slug): ${courseCode}`);
  return slug;
}

export async function writeJson(filePath, data) {
  await Bun.write(filePath, JSON.stringify(data, null, 2) + "\n");
  return filePath;
}

export function tmpPath(tmpDir, name) {
  return path.join(tmpDir, name);
}
