import { resolveDelayMs, sleep } from "./util.js";
import {
  buildSelectPayload,
  findEnrolledSection,
  indexPreadvByFormal,
  isSelectionOpen,
  normalizeSectionLetters,
  pickSection,
  resolveCourseCode,
  validateSelections,
  waitUntilOpen,
} from "./sections.js";

async function trySelect(api, courseCode, payload, selectOpts) {
  const attempts = (selectOpts.retry_on_failure ?? 0) + 1;

  for (let i = 0; i < attempts; i++) {
    try {
      return await api.selectSection(courseCode, payload);
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(selectOpts.retry_delay_ms ?? 800);
    }
  }
}

function skipIfAlreadyEnrolled({
  skipIfEnrolled,
  doneCourses,
  formalCode,
  courseCode,
  sections,
  log,
}) {
  if (!skipIfEnrolled) return null;

  const enrolled = findEnrolledSection(sections);
  if (!enrolled) return null;

  doneCourses.add(formalCode);
  log(
    `Skip ${formalCode}: already in section ${enrolled.section_name} (no change)`,
  );
  return {
    formalCode,
    courseCode,
    ok: true,
    skipped: true,
    section: enrolled.section_name,
    reason: "already_enrolled",
  };
}

async function selectOne(api, entry, ctx) {
  const { department, selectOpts, preadvByFormal, getConf, log, doneCourses } =
    ctx;
  const formalCode = entry.formal_code;
  const courseCode = resolveCourseCode(entry, preadvByFormal);
  const letters = normalizeSectionLetters(entry);
  const skipIfEnrolled = selectOpts.skip_if_enrolled !== false;

  if (skipIfEnrolled && doneCourses.has(formalCode)) {
    log(`Skip ${formalCode}: already handled this run`);
    return {
      formalCode,
      courseCode,
      ok: true,
      skipped: true,
      reason: "already_handled",
    };
  }

  let conf = getConf();
  let detail = await api.getCourseSections(courseCode);

  let skip = skipIfAlreadyEnrolled({
    skipIfEnrolled,
    doneCourses,
    formalCode,
    courseCode,
    sections: detail.data?.sections ?? [],
    log,
  });
  if (skip) return skip;

  if (!selectOpts.skip_time_check) {
    if (!isSelectionOpen(conf, department, detail.data)) {
      if (!selectOpts.wait_until_open) {
        return { formalCode, courseCode, ok: false, error: "Selection not open" };
      }

      log(`Waiting for ${formalCode}...`);
      conf = await waitUntilOpen(api, department, selectOpts, async (c) => {
        const d = await api.getCourseSections(courseCode);
        detail = d;
        ctx.setConf(c);
        return isSelectionOpen(c, department, d.data);
      });

      if (!conf || !isSelectionOpen(conf, department, detail.data)) {
        return {
          formalCode,
          courseCode,
          ok: false,
          error: "Selection window did not open in time",
        };
      }
    }
  } else {
    log(`Skip time check for ${formalCode}`);
  }

  skip = skipIfAlreadyEnrolled({
    skipIfEnrolled,
    doneCourses,
    formalCode,
    courseCode,
    sections: detail.data?.sections ?? [],
    log,
  });
  if (skip) return skip;

  const sections = detail.data?.sections ?? [];
  const picked = pickSection(sections, letters);
  if (!picked) {
    return {
      formalCode,
      courseCode,
      ok: false,
      error: `No open section in ${letters.join(", ")}`,
    };
  }

  const { section, letter } = picked;
  const payload = buildSelectPayload(courseCode, section);

  log(
    `Select ${formalCode} → ${section.section_name}` +
      (section.faculty_code ? ` (${section.faculty_code})` : "") +
      ` [${letter}]`,
  );

  if (selectOpts.dry_run) {
    return {
      formalCode,
      courseCode,
      ok: true,
      dryRun: true,
      section: section.section_name,
      payload,
    };
  }

  const res = await trySelect(api, courseCode, payload, selectOpts);
  doneCourses.add(formalCode);
  return {
    formalCode,
    courseCode,
    ok: true,
    section: section.section_name,
    message: res.data?.message,
  };
}

export async function runSelections(api, config, traffic = null) {
  const log = (msg) => (traffic ? traffic.log(msg) : console.log(msg));
  const selectOpts = config.select ?? {};
  const department = config.department ?? "011";
  const selections = config.selections ?? [];
  const delaySpec = selectOpts.min_delay_ms ?? 0;

  const [confRes, preadvRes, eligRes] = await Promise.all([
    api.getConfig(),
    api.getPreadviceCourses(),
    api.getEligibility(),
  ]);

  if (!eligRes.data?.eligible) {
    throw new Error(
      eligRes.data?.special_note || "Account not eligible for section selection",
    );
  }

  const preadvCourses = preadvRes.data?.courses ?? [];
  const preadvByFormal = indexPreadvByFormal(preadvCourses);
  validateSelections(selections, preadvByFormal);

  let conf = confRes.data;
  const doneCourses = new Set();
  const ctx = {
    department,
    selectOpts,
    preadvByFormal,
    log,
    doneCourses,
    getConf: () => conf,
    setConf: (c) => {
      conf = c;
    },
  };

  const results = [];

  for (let i = 0; i < selections.length; i++) {
    try {
      results.push(await selectOne(api, selections[i], ctx));
    } catch (err) {
      results.push({
        formalCode: selections[i].formal_code,
        ok: false,
        error: err.message,
      });
    }

    if (delaySpec && i < selections.length - 1) {
      const delay = resolveDelayMs(delaySpec);
      if (delay > 0) {
        log(`Pause ${delay}ms before next course…`);
        await sleep(delay);
      }
    }
  }

  if (selectOpts.register_after && !selectOpts.dry_run) {
    const didSelect = results.some((r) => r.ok && !r.skipped && !r.dryRun);
    if (didSelect) {
      log("Registering (POST /courses/register)...");
      await api.register();
      log("Registration submitted.");
    }
  }

  return results;
}
