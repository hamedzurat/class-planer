import { sleep } from "./util.js";

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

export function buildSelectPayload(courseCode, section) {
  return {
    section_id: section.section_id,
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
