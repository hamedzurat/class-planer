import path from "node:path";

export function courseFileSlug(courseCode) {
  return courseCode.split("-")[0];
}

export async function writeJson(filePath, data) {
  await Bun.write(filePath, JSON.stringify(data, null, 2) + "\n");
  return filePath;
}

export function tmpPath(tmpDir, name) {
  return path.join(tmpDir, name);
}
