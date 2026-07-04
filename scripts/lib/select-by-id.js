import fs from "node:fs";
import path from "node:path";
import { resolveOutputPaths } from "./config.js";
import { courseFileSlug } from "./io.js";
import {
  buildSelectPayload,
  isEphemeralSectionUuid,
  parseSectionRef,
  resolveLiveSection,
} from "./sections.js";

const FORMAL_SECTION_RE = /^(.+?):([A-Za-z0-9]+)$/;

/** @param {string} sectionsFile */
function loadLocalCourses(sectionsFile) {
  try {
    const raw = fs.readFileSync(sectionsFile, "utf8");
    const json = JSON.parse(raw);
    return json.data?.courses ?? json.courses ?? [];
  } catch {
    return null;
  }
}

/** @param {string} tmpDir */
function loadPreadvCourses(tmpDir) {
  try {
    const raw = fs.readFileSync(path.join(tmpDir, "preadv.json"), "utf8");
    const json = JSON.parse(raw);
    return json.data?.courses ?? [];
  } catch {
    return null;
  }
}

/** @param {string} tmpDir @param {string} courseCode */
function loadLocalCourseDetail(tmpDir, courseCode) {
  const file = path.join(tmpDir, `${courseFileSlug(courseCode)}.json`);
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** @param {object} config @param {string} formalCode */
function resolveCourseCodeFromFormal(config, formalCode) {
  const target = formalCode.trim().toUpperCase();
  const { sectionsFile, tmpDir } = resolveOutputPaths(config);

  const preadv = loadPreadvCourses(tmpDir) ?? [];
  const fromPreadv = preadv.find(
    (c) => (c.formal_code || "").trim().toUpperCase() === target,
  );
  if (fromPreadv) return fromPreadv.course_code;

  const courses = loadLocalCourses(sectionsFile) ?? [];
  const fromList = courses.find(
    (c) => (c.formal_code || "").trim().toUpperCase() === target,
  );
  if (fromList) return fromList.course_code;

  throw new Error(
    `formal_code "${formalCode}" not found locally. Run fetch or pass --course.`,
  );
}

/** @param {Array<{ sections?: Array<{ section_id?: unknown }> }>} courses @param {string} uuid */
function findUuidInCourses(courses, uuid) {
  for (const course of courses) {
    for (const section of course.sections ?? []) {
      if (String(section.section_id).toLowerCase() === uuid) {
        return { course, section, courseCode: course.course_code };
      }
    }
  }
  return null;
}

/** @param {object} config @param {string} uuid @param {string | undefined} courseCode */
function resolveSnapshotByUuid(config, uuid, courseCode) {
  const { sectionsFile, tmpDir } = resolveOutputPaths(config);

  if (courseCode) {
    const detail = loadLocalCourseDetail(tmpDir, courseCode);
    const fromDetail = detail?.sections?.find(
      (s) => String(s.section_id).toLowerCase() === uuid,
    );
    if (fromDetail) {
      return { course: detail, section: fromDetail, courseCode, source: "tmp" };
    }
    const courses = loadLocalCourses(sectionsFile);
    const course = courses?.find((c) => c.course_code === courseCode);
    const fromList = course?.sections?.find(
      (s) => String(s.section_id).toLowerCase() === uuid,
    );
    if (fromList) {
      return { course, section: fromList, courseCode, source: "res.json" };
    }
    throw new Error(`List UUID not found for ${courseCode}. Run fetch.`);
  }

  const courses = loadLocalCourses(sectionsFile);
  if (!courses) return null;
  const hit = findUuidInCourses(courses, uuid);
  if (!hit) return null;
  return { ...hit, source: "res.json" };
}

/**
 * @param {object} config
 * @param {object} opts
 * @param {string} [opts.formalCode]
 * @param {string} [opts.sectionLetter]
 * @param {string} [opts.sectionRef]
 * @param {string} [opts.courseCode]
 * @param {string} [opts.facultyCode]
 */
function resolvePickTarget(config, opts) {
  let formalCode = opts.formalCode?.trim();
  let sectionLetter = opts.sectionLetter?.trim().toUpperCase();
  let facultyCode = opts.facultyCode?.trim();
  let courseCode = opts.courseCode?.trim();
  let numericId = null;
  let fromUuid = false;
  /** @type {{ section_name?: string, faculty_code?: string, section_id?: unknown } | null} */
  let sectionHint = null;

  if (opts.sectionRef) {
    const ref = parseSectionRef(opts.sectionRef);
    if (ref.kind === "numeric") {
      numericId = ref.numericId;
      if (!courseCode && formalCode) {
        courseCode = resolveCourseCodeFromFormal(config, formalCode);
      }
      if (!courseCode) {
        throw new Error(
          "Numeric section_id requires --course or --formal-code",
        );
      }
    } else {
      fromUuid = true;
      const snap = resolveSnapshotByUuid(config, ref.uuid, courseCode);
      if (!snap) {
        throw new Error(
          "List UUID not found in res.json — use --formal-code + --section instead",
        );
      }
      formalCode = snap.course.formal_code ?? formalCode;
      courseCode = snap.courseCode;
      sectionLetter = (snap.section.section_name || "").trim().toUpperCase();
      facultyCode = snap.section.faculty_code || facultyCode;
      sectionHint = snap.section;
      if (isEphemeralSectionUuid(snap.section.section_id)) {
        // converted below in caller log
      }
    }
  }

  if (!formalCode || !sectionLetter) {
    throw new Error(
      "Specify --formal-code + --section, shorthand CSE4326:H, or a list UUID",
    );
  }

  if (!courseCode) {
    courseCode = resolveCourseCodeFromFormal(config, formalCode);
  }

  if (!sectionHint) {
    sectionHint = {
      section_name: sectionLetter,
      ...(facultyCode ? { faculty_code: facultyCode } : {}),
    };
  }

  return {
    formalCode,
    sectionLetter,
    facultyCode,
    courseCode,
    numericId,
    sectionHint,
    fromUuid,
  };
}

/**
 * @param {import('./api.js').UcamApi | null} api
 * @param {object} config
 * @param {object} opts
 */
export async function selectBySectionId(api, config, opts) {
  const log = opts.log ?? console.log;
  const action = opts.action ?? "select";
  const dryRun = opts.dryRun !== false;

  const target = resolvePickTarget(config, opts);
  const {
    formalCode,
    sectionLetter,
    facultyCode,
    courseCode,
    numericId,
    sectionHint,
    fromUuid,
  } = target;

  if (fromUuid) {
    log(
      `List UUID → ${formalCode} section ${sectionLetter}` +
        (facultyCode ? ` (${facultyCode})` : "") +
        " (UUID not used for POST)",
    );
  } else {
    log(
      `Target: ${formalCode} section ${sectionLetter}` +
        (facultyCode ? ` (${facultyCode})` : "") +
        ` → ${courseCode}`,
    );
  }

  let liveSection = null;
  let previewPayload = null;

  if (dryRun && opts.localOnly) {
    previewPayload = {
      section_id: "<numeric from GET /courses/sections/{course}>",
      action,
      parent_course_code: courseCode,
      _match: {
        formal_code: formalCode,
        section_name: sectionLetter,
        ...(facultyCode ? { faculty_code: facultyCode } : {}),
      },
    };
    if (numericId != null) {
      previewPayload.section_id = numericId;
      previewPayload._note =
        "numeric id may change; prefer formal_code + section";
    }
  } else {
    if (!api) throw new Error("API client required (--fetch or --send)");
    const live = await resolveLiveSection(
      api,
      courseCode,
      numericId != null
        ? { numericId }
        : { section: sectionHint ?? { section_name: sectionLetter } },
    );
    liveSection = live.section;
    log(`Live match via GET /courses/sections/${courseCode}`);
    if (liveSection?.section_id != null) {
      log(`Numeric section_id for POST: ${liveSection.section_id}`);
    }
  }

  const payload = previewPayload ?? {
    ...buildSelectPayload(courseCode, liveSection),
    action,
  };

  log(
    `${action === "remove" ? "Remove" : "Select"} ${formalCode} → ${sectionLetter}` +
      (facultyCode ? ` (${facultyCode})` : "") +
      `\n  POST /courses/sections/${courseCode}/select`,
  );

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      formalCode,
      courseCode,
      section: sectionLetter,
      sectionId: liveSection?.section_id ?? numericId,
      payload,
    };
  }

  const res = await api.selectSection(courseCode, payload);
  return {
    ok: true,
    formalCode,
    courseCode,
    section: liveSection?.section_name ?? sectionLetter,
    sectionId: liveSection?.section_id,
    message: res.data?.message,
    payload,
  };
}

/** @param {string} value */
function parseFormalSectionShorthand(value) {
  const m = value.trim().match(FORMAL_SECTION_RE);
  if (!m) return null;
  return { formalCode: m[1].trim(), sectionLetter: m[2].trim() };
}

/** @param {string[]} argv */
export function parsePickArgs(argv) {
  /** @type {{ formalCode?: string, sectionLetter?: string, sectionRef?: string, courseCode?: string, facultyCode?: string, action: "select" | "remove", dryRun: boolean, localOnly: boolean, noTui: boolean, help?: boolean }} */
  const out = {
    action: "select",
    dryRun: true,
    localOnly: true,
    noTui: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-tui") out.noTui = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--send") out.dryRun = false;
    else if (arg === "--fetch") out.localOnly = false;
    else if (arg === "--remove") out.action = "remove";
    else if (
      arg === "--formal-code" ||
      arg === "--formal_code" ||
      arg === "-f"
    ) {
      out.formalCode = argv[++i];
    } else if (
      arg.startsWith("--formal-code=") ||
      arg.startsWith("--formal_code=")
    ) {
      out.formalCode = arg.split("=").slice(1).join("=");
    } else if (arg === "--section" || arg === "-s")
      out.sectionLetter = argv[++i];
    else if (arg.startsWith("--section=")) out.sectionLetter = arg.slice(10);
    else if (arg === "--course") out.courseCode = argv[++i];
    else if (arg.startsWith("--course=")) out.courseCode = arg.slice(9);
    else if (arg === "--faculty") out.facultyCode = argv[++i];
    else if (arg.startsWith("--faculty=")) out.facultyCode = arg.slice(10);
    else if (arg === "-h" || arg === "--help" || arg === "help") {
      return { ...out, help: true };
    } else positional.push(arg);
  }

  for (const arg of positional) {
    const shorthand = parseFormalSectionShorthand(arg);
    if (shorthand) {
      out.formalCode ??= shorthand.formalCode;
      out.sectionLetter ??= shorthand.sectionLetter;
      continue;
    }
    if (!out.sectionRef) {
      out.sectionRef = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return out;
}

export const PICK_USAGE = `\
Pick one section — prefers formal_code + section letter (list UUIDs are converted automatically).

  just ucam-pick-section "CSE 4326" H
  just ucam-pick --formal-code "CSE 4326" --section H

List UUID from res.json (auto → formal_code + section):

  just ucam-pick <list-uuid>
  just ucam-pick c7daa899-42e9-4084-b565-baa85086c052

Send (live GET /courses/sections/{course} → numeric section_id → POST):

  just ucam-pick-section "CSE 4326" H --send
  just ucam-pick <list-uuid> --send

Options:
  --formal-code, -f   e.g. "CSE 4326"
  --section, -s       section letter e.g. "H"
  --course            override course code (usually resolved from preadv/res.json)
  --faculty           disambiguate when multiple sections share a letter
  --fetch             resolve live numeric id (dry-run, no POST)
  --send              POST to UCAM
  --remove            action: remove
  --no-tui            plain output when using --send
`;
