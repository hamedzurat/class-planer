import { resolveOutputPaths } from "./config.js";
import { courseFileSlug, tmpPath, writeJson } from "./io.js";

export async function fetchAll(api, config) {
  const { tmpDir, sectionsFile } = resolveOutputPaths(config);
  const department = config.department ?? "011";

  const [pub, conf, me, elig, preadv, all] = await Promise.all([
    api.getPublicConfig(),
    api.getConfig(),
    api.getMe(),
    api.getEligibility(),
    api.getPreadviceCourses(),
    api.getAllSections(department),
  ]);

  const saved = await Promise.all([
    writeJson(tmpPath(tmpDir, "pub.json"), pub),
    writeJson(tmpPath(tmpDir, "conf.json"), conf),
    writeJson(tmpPath(tmpDir, "features.json"), me),
    writeJson(tmpPath(tmpDir, "elig.json"), elig),
    writeJson(tmpPath(tmpDir, "preadv.json"), preadv),
    writeJson(sectionsFile, all),
  ]);

  const courses = preadv.data?.courses ?? [];
  saved.push(
    ...(await Promise.all(
      courses.map(async (course) => {
        const detail = await api.getCourseSections(course.course_code);
        return writeJson(
          tmpPath(tmpDir, `${courseFileSlug(course.course_code)}.json`),
          detail,
        );
      }),
    )),
  );

  return saved;
}
