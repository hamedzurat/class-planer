import { sleep } from "./util.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function indexPreadvByFormal(courses) {
  return new Map(courses.map((c) => [c.formal_code, c]));
}

export function validateSelections(selections, preadvByFormal) {
  if (selections.length === 0) {
    throw new Error("No selections configured in scripts/config.js");
  }

  for (const entry of selections) {
    if (!entry.formal_code) {
      throw new Error("Each selection requires formal_code");
    }
    if (!preadvByFormal.has(entry.formal_code)) {
      throw new Error(
        `formal_code "${entry.formal_code}" not in pre-advised courses`,
      );
    }
    normalizeSectionLetters(entry);
  }
}

export function isSelectionOpen(configData, department, courseDetail) {
  const globalOpen = configData?.section_selection_status === "open";
  const dept = configData?.section_selection?.[department];
  if (!globalOpen || dept?.is_open !== true) return false;

  const now = Date.now();
  const startMs = parseTime(
    courseDetail?.effective_start_time ?? dept?.start_time,
  );
  const endMs = parseTime(
    courseDetail?.section_selection_end_time ?? dept?.end_time,
  );

  if (startMs !== null && now < startMs) return false;
  if (endMs !== null && now > endMs) return false;
  if (courseDetail?.selection_open === false) return false;

  return true;
}

function parseTime(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function isSectionAvailable(section) {
  return (
    section.seats_taken < section.total_seats &&
    !section.stop_option_to_change_section
  );
}

export function pickSection(sections, letters) {
  for (const letter of letters) {
    const target = letter.trim().toUpperCase();
    const section = sections.find(
      (s) =>
        isSectionAvailable(s) &&
        (s.section_name || "").trim().toUpperCase() === target,
    );
    if (section) return { letter, section };
  }
  return null;
}

export function resolveCourseCode(entry, preadvByFormal) {
  return preadvByFormal.get(entry.formal_code).course_code;
}

/** @param {unknown} id */
export function isEphemeralSectionUuid(id) {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

/** @param {{ section_id?: unknown, course_code?: string }} section @param {string} [courseCode] */
export function postSectionId(section, courseCode = section.course_code) {
  const id = section.section_id;

  if (typeof id === "number" && Number.isInteger(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id.trim()))
    return Number(id.trim());

  const label = courseCode ? ` for ${courseCode}` : "";
  throw new Error(
    `section_id must be numeric for POST${label} (got ${JSON.stringify(id)}). ` +
      "Use GET /courses/sections/{course} while selection is open — " +
      "bulk res.json UUIDs are not valid select ids.",
  );
}

/** @param {{ section_name?: string, faculty_code?: string }} section */
export function sectionIdentityKey(section) {
  const name = (section.section_name || "").trim().toUpperCase();
  const faculty = (section.faculty_code || "").trim().toUpperCase();
  return faculty ? `${name}|${faculty}` : name;
}

/** @param {Array<{ section_name?: string, faculty_code?: string }>} sections @param {{ section_name?: string, faculty_code?: string }} target */
export function matchSectionByIdentity(sections, target) {
  const key = sectionIdentityKey(target);
  const nameOnly = (target.section_name || "").trim().toUpperCase();

  const exact = sections.filter(
    (s) =>
      sectionIdentityKey(s) === key ||
      (!target.faculty_code &&
        (s.section_name || "").trim().toUpperCase() === nameOnly),
  );

  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Ambiguous section match for ${nameOnly} — multiple sections. ` +
        `Pass faculty_code or use config select by letter.`,
    );
  }
  return null;
}

/**
 * GET /courses/sections/{course} — same source as the browser selection page.
 * @param {import('./api.js').UcamApi} api
 * @param {string} courseCode
 */
export async function getCourseDetail(api, courseCode) {
  const res = await api.getCourseSections(courseCode);
  const data = res.data;
  return { data, sections: data?.sections ?? [] };
}

/**
 * Per-course detail with at least one section (required before POST).
 * @param {import('./api.js').UcamApi} api
 * @param {string} courseCode
 */
export async function fetchCourseSections(api, courseCode) {
  const detail = await getCourseDetail(api, courseCode);

  if (detail.sections.length === 0) {
    throw new Error(
      `GET /courses/sections/${courseCode} returned no sections. ` +
        "Selection may not be open for this course yet.",
    );
  }

  return detail;
}

/**
 * Resolve a section for POST using live per-course detail (numeric section_id).
 * @param {import('./api.js').UcamApi} api
 * @param {string} courseCode
 * @param {{ numericId?: number, section?: { section_name?: string, faculty_code?: string } }} hint
 */
export async function resolveLiveSection(api, courseCode, hint) {
  const { data, sections } = await fetchCourseSections(api, courseCode);

  let section = null;
  if (hint.numericId != null) {
    section = sections.find((s) => {
      try {
        return postSectionId(s, courseCode) === hint.numericId;
      } catch {
        return false;
      }
    });
    if (!section) {
      throw new Error(
        `Numeric section_id ${hint.numericId} not found in GET /courses/sections/${courseCode}`,
      );
    }
  } else if (hint.section) {
    section = matchSectionByIdentity(sections, hint.section);
    if (!section) {
      const available = sections
        .map(
          (s) =>
            s.section_name + (s.faculty_code ? ` (${s.faculty_code})` : ""),
        )
        .join(", ");
      throw new Error(
        `Section ${hint.section.section_name} not in live course detail. ` +
          `Available: ${available || "(none)"}`,
      );
    }
  } else {
    throw new Error(
      "resolveLiveSection requires numericId or section identity",
    );
  }

  postSectionId(section, courseCode);
  return { course: data, section, courseCode };
}

/** @param {string} courseCode @param {{ section_id?: unknown, isMapped?: boolean, course_code?: string }} section */
export function buildSelectPayload(courseCode, section) {
  return {
    section_id: postSectionId(section, courseCode),
    action: "select",
    parent_course_code: section.isMapped ? section.course_code : courseCode,
  };
}

export function normalizeSectionLetters(entry) {
  const list = [].concat(entry.sections ?? []);
  if (list.length === 0 || list.some((v) => !String(v).trim())) {
    throw new Error(`sections required for ${entry.formal_code}`);
  }
  return list;
}

/** @param {Array<{ is_enrolled?: boolean, section_name?: string }>} sections */
export function findEnrolledSection(sections) {
  return sections.find((s) => s.is_enrolled) ?? null;
}

export async function waitUntilOpen(api, department, selectOpts, isOpen) {
  const deadline = Date.now() + (selectOpts.max_wait_ms ?? 600_000);
  const interval = selectOpts.poll_interval_ms ?? 2000;

  while (Date.now() < deadline) {
    const conf = (await api.getConfig()).data;
    if (await isOpen(conf)) return conf;
    await sleep(interval);
  }

  return null;
}

/** @param {string} ref */
export function parseSectionRef(ref) {
  const value = ref.trim();
  if (/^\d+$/.test(value)) {
    return { kind: /** @type {const} */ ("numeric"), numericId: Number(value) };
  }
  if (UUID_RE.test(value)) {
    return { kind: /** @type {const} */ ("uuid"), uuid: value.toLowerCase() };
  }
  throw new Error(`Invalid section ref (numeric id or UUID): ${ref}`);
}
