import { mkdir } from "node:fs/promises";

const SECTION_FILE = "res.json";
const COURSES_CONFIG_FILE = "courses.json";
const OUTPUT_DIR = "tsv";
const FACULTY_FILE = `${OUTPUT_DIR}/faculty/_.tsv`;

const TIME_SLOTS = ["8:30", "9:50", "11:10", "12:30", "13:50", "15:10"];

const DAY_GROUPS = [
  { name: "Sat + Tue", days: ["Saturday", "Tuesday"], type: "theory" },
  { name: "Sat", days: ["Saturday"], type: "lab" },
  { name: "Sun + Wed", days: ["Sunday", "Wednesday"], type: "theory" },
  { name: "Sun", days: ["Sunday"], type: "lab" },
  { name: "Mon", days: ["Monday"], type: "lab" },
  { name: "Tue", days: ["Tuesday"], type: "lab" },
  { name: "Wed", days: ["Wednesday"], type: "lab" },
  { name: "Thu", days: ["Thursday"], type: "none" },
  { name: "Fri", days: ["Friday"], type: "none" },
];

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function safeFileName(name) {
  return name
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function generateShortName(fullName) {
  const words = fullName
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return "UNKNOWN";

  let isLab = false;
  if (words[words.length - 1].toLowerCase() === "laboratory") {
    isLab = true;
    words.pop();
  }

  let acronym = words.map((w) => w[0].toUpperCase()).join("");
  return isLab ? `${acronym}-lab` : acronym;
}

function isSectionStartingInSlot(section, targetTime, expectedDays) {
  const [tH, tM] = targetTime.split(":").map(Number);
  const blockStart = (tH || 0) * 60 + (tM || 0);
  const blockEnd = blockStart + 80;

  for (const s of section.schedule) {
    if (expectedDays.includes(s.day)) {
      const [sH, sM] = s.start_time.split(":").map(Number);
      const schedStart = (sH || 0) * 60 + (sM || 0);
      if (schedStart >= blockStart && schedStart < blockEnd) {
        return true;
      }
    }
  }
  return false;
}

function detectCollisions(studentId, courses) {
  console.log(
    `   ${colors.cyan}Analyzing room and faculty bookings for collisions (${studentId})...${colors.reset}`,
  );

  // Group assignments by day first — avoids O(n²) cross-day comparisons
  /** @type {Map<string, Array<object>>} */
  const byDay = new Map();

  for (const course of courses) {
    for (const section of course.sections) {
      for (const sched of section.schedule) {
        const [sh, sm] = sched.start_time.split(":").map(Number);
        const [eh, em] = sched.end_time.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const roomMatch = (section.room_details || "").match(/^\d+/);
        const room = roomMatch ? roomMatch[0] : "";
        const entry = {
          courseCode: course.course_code,
          courseName: course.course_name,
          sectionName: section.section_name,
          facultyCode: section.faculty_code || "",
          facultyName: section.faculty_name || "",
          room,
          day: sched.day,
          startMin,
          endMin,
          rawStart: sched.start_time,
          rawEnd: sched.end_time,
        };
        if (!byDay.has(sched.day)) byDay.set(sched.day, []);
        byDay.get(sched.day).push(entry);
      }
    }
  }

  let collisionsFound = false;

  for (const [, assignments] of byDay) {
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1 = assignments[i];
        const a2 = assignments[j];

        if (
          Math.max(a1.startMin, a2.startMin) < Math.min(a1.endMin, a2.endMin)
        ) {
          // Room collision
          if (a1.room && a1.room === a2.room) {
            console.warn(
              `      ${colors.yellow}[Collision] Room ${a1.room} double-booking on ${a1.day}:${colors.reset}\n` +
                `                * ${a1.courseName} (${a1.courseCode}) Sec ${a1.sectionName} (${a1.rawStart} - ${a1.rawEnd})\n` +
                `                * ${a2.courseName} (${a2.courseCode}) Sec ${a2.sectionName} (${a2.rawStart} - ${a2.rawEnd})`,
            );
            collisionsFound = true;
          }
          // Faculty collision
          if (a1.facultyCode && a1.facultyCode === a2.facultyCode) {
            console.warn(
              `      ${colors.yellow}[Collision] Faculty ${a1.facultyName} (${a1.facultyCode}) double-booking on ${a1.day}:${colors.reset}\n` +
                `                * ${a1.courseName} (${a1.courseCode}) Sec ${a1.sectionName} (${a1.rawStart} - ${a1.rawEnd})\n` +
                `                * ${a2.courseName} (${a2.courseCode}) Sec ${a2.sectionName} (${a2.rawStart} - ${a2.rawEnd})`,
            );
            collisionsFound = true;
          }
        }
      }
    }
  }

  if (!collisionsFound) {
    console.log(
      `      ${colors.green}*${colors.reset} No room or faculty double-bookings detected.\n`,
    );
  } else {
    console.log("");
  }
}

async function validateOutputs(courses) {
  console.log(
    `${colors.cyan}Running automated output verification...${colors.reset}`,
  );
  const errors = [];
  const expectedFaculties = new Map();

  for (const course of courses) {
    const expectedTsvName = `${safeFileName(course.course_name)}.tsv`;
    const tsvPath = `${OUTPUT_DIR}/courses/${expectedTsvName}`;

    const file = Bun.file(tsvPath);
    if (!(await file.exists())) {
      errors.push(`Missing TSV file: ${tsvPath}`);
      continue;
    }

    const content = await file.text();
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headers = lines[0].split("\t");
    const rows = lines.slice(1).map((line) => {
      const parts = line.split("\t");
      const row = {};
      headers.forEach((h, i) => {
        row[h] = parts[i] || "";
      });
      return row;
    });

    for (const section of course.sections) {
      const row = rows.find((r) => r["Section"] === section.section_name);
      if (!row) {
        errors.push(
          `Course "${course.course_name}" section "${section.section_name}" is missing from ${tsvPath}`,
        );
        continue;
      }

      let expFacultyName = section.faculty_name || "";
      let expFacultyCode = section.faculty_code || "";
      if (
        !expFacultyName ||
        !expFacultyCode ||
        expFacultyName === "TBA" ||
        expFacultyCode === "TBA"
      ) {
        expFacultyName = "";
        expFacultyCode = "";
      } else {
        expectedFaculties.set(expFacultyCode, expFacultyName);
      }

      if (row["Faculty Code"] !== expFacultyCode) {
        errors.push(
          `Faculty Code mismatch in ${tsvPath} for section ${section.section_name}: expected "${expFacultyCode}", got "${row["Faculty Code"]}"`,
        );
      }
      if (row["Faculty Name"] !== expFacultyName) {
        errors.push(
          `Faculty Name mismatch in ${tsvPath} for section ${section.section_name}: expected "${expFacultyName}", got "${row["Faculty Name"]}"`,
        );
      }
    }
  }

  // Check combined faculty file
  const facFile = Bun.file(FACULTY_FILE);
  if (!(await facFile.exists())) {
    errors.push(`Missing faculty list: ${FACULTY_FILE}`);
  } else {
    const content = await facFile.text();
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headers = lines[0].split("\t");
    const rows = lines.slice(1).map((line) => {
      const parts = line.split("\t");
      const row = {};
      headers.forEach((h, i) => {
        row[h] = parts[i] || "";
      });
      return row;
    });

    expectedFaculties.forEach((name, code) => {
      const row = rows.find((r) => r["Faculty Code"] === code);
      if (!row) {
        errors.push(`Faculty "${name}" (${code}) missing from ${FACULTY_FILE}`);
      } else if (row["Faculty Name"] !== name) {
        errors.push(
          `Faculty Name mismatch in ${FACULTY_FILE} for ${code}: expected "${name}", got "${row["Faculty Name"]}"`,
        );
      }
    });
  }

  if (errors.length === 0) {
    console.log(
      `   ${colors.green}*${colors.reset} Verification passed: All generated course and faculty files match source data perfectly.\n`,
    );
  } else {
    console.error(
      `${colors.red}Verification failed with ${errors.length} errors:${colors.reset}`,
    );
    errors.forEach((e) => console.error(`   - ${e}`));
  }
}
function generateHtmlDisplay(studentId, activeColumns, finalRows) {
  const DAY_GROUP_COLORS = {
    "Sat + Tue": { bg: "#f9cb9c", text: "#000000" },
    Sat: { bg: "#b6d7a8", text: "#000000" },
    "Sun + Wed": { bg: "#ea9999", text: "#000000" },
    Sun: { bg: "#9fc5e8", text: "#000000" },
    Mon: { bg: "#dd7e6b", text: "#000000" },
    Tue: { bg: "#a2c4c9", text: "#000000" },
    Wed: { bg: "#b4a7d6", text: "#000000" },
    Thu: { bg: "#b7b7b7", text: "#000000" },
    Fri: { bg: "#b7b7b7", text: "#000000" },
  };

  // Group Row 1 columns to calculate colspans
  const headerGroups = [];
  let currentGroup = null;
  for (let i = 1; i < activeColumns.length; i++) {
    const col = activeColumns[i];
    const groupName = col.groupName || col.courseShort;
    if (currentGroup && currentGroup.name === groupName) {
      currentGroup.count++;
    } else {
      currentGroup = { name: groupName, count: 1 };
      headerGroups.push(currentGroup);
    }
  }

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Schedule Matrix - ${studentId}</title>
</head>
<body style="margin: 0; padding: 0;">
  <table class="waffle" cellspacing="0" cellpadding="0" style="border-collapse: collapse; font-family: 'Lexend', Arial, sans-serif; font-size: 11pt;">
  `;

  // Row 1: Group headers
  html += '      <tr style="height: 20px;">\n';
  // TIME has rowspan 2
  html += `        <td style="background-color: #000000; text-align: center; font-weight: bold; color: #ffffff; font-family: 'Lexend', Arial, sans-serif; font-size: 16pt; vertical-align: middle; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;" rowspan="2">TIME</td>\n`;
  for (const group of headerGroups) {
    const colorInfo = DAY_GROUP_COLORS[group.name] || {
      bg: "#b7b7b7",
      text: "#000000",
    };
    const fontStr =
      group.name === "Thu" || group.name === "Fri"
        ? "'Fira Code', Arial, monospace"
        : "'Lexend', Arial, sans-serif";
    const colspanAttr = group.count > 1 ? ` colspan="${group.count}"` : "";
    html += `        <td style="background-color: ${colorInfo.bg}; text-align: center; font-weight: bold; color: ${colorInfo.text}; font-family: ${fontStr}; font-size: 16pt; vertical-align: middle; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;"${colspanAttr}>${group.name}</td>\n`;
  }
  html += "      </tr>\n";

  // Row 2: Course short names
  html += '      <tr style="height: 20px;">\n';
  const row2 = finalRows[1];
  for (let colIdx = 1; colIdx < row2.length; colIdx++) {
    const val = row2[colIdx];
    const col = activeColumns[colIdx];

    if (val === "xxx") {
      // Thu/Fri placeholder
      html += `        <td style="background-color: #b7b7b7; text-align: center; font-weight: bold; color: #666666; font-family: 'Fira Code', Arial, monospace; font-size: 16pt; vertical-align: bottom; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;">${val}</td>\n`;
    } else {
      const isLab = col && col.type === "lab";
      const underlineStyle = isLab
        ? "text-decoration: underline; text-decoration-skip-ink: none; -webkit-text-decoration-skip: none;"
        : "";
      html += `        <td style="background-color: #ffffff; text-align: center; ${underlineStyle} color: #000000; font-family: 'Lexend', Arial, sans-serif; font-size: 16pt; vertical-align: bottom; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;">${val}</td>\n`;
    }
  }
  html += "      </tr>\n";

  // Data rows
  for (let rIdx = 2; rIdx < finalRows.length; rIdx++) {
    html += '      <tr style="height: 20px;">\n';
    const row = finalRows[rIdx];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const val = row[colIdx];
      const col = activeColumns[colIdx];

      if (colIdx === 0) {
        // Time column (s14)
        html += `        <td style="background-color: #ffffff; text-align: right; color: #000000; font-family: 'Lexend', Arial, sans-serif; font-size: 16pt; vertical-align: bottom; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;">${val}</td>\n`;
      } else if (val === "x") {
        // None cells (Thu/Fri/etc. - s16)
        html += `        <td style="background-color: #b7b7b7; text-align: center; color: #666666; font-family: 'Fira Code', Arial, monospace; font-size: 16pt; vertical-align: bottom; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;">${val}</td>\n`;
      } else {
        // Populated or empty active cell
        const isStartingTimeRow = row[0] !== "";
        const isNoneCol = col && col.type === "none";
        let bg = "#ffffff";

        if (isStartingTimeRow && col && !isNoneCol) {
          if (col.type === "lab") {
            // Labs only start on 8:30, 11:10, 13:50
            const time = row[0];
            if (time === "8:30" || time === "11:10" || time === "13:50") {
              bg = "#d9d9d9";
            }
          } else {
            // Theory starts on all time slots
            bg = "#d9d9d9";
          }
        }
        html += `        <td style="background-color: ${bg}; text-align: center; color: #000000; font-family: 'Lexend', Arial, sans-serif; font-size: 14pt; vertical-align: bottom; white-space: nowrap; padding: 2px 3px 2px 3px; border: 1px solid #cbd5e1;">${val}</td>\n`;
      }
    }
    html += "      </tr>\n";
  }

  html += `  </table>
</body>
</html>
`;
  return html;
}

/**
 * @param {string} studentId
 * @param {Record<string, string>} targetConfig  formal_code → short name map
 * @param {Array<object>} allCourses             full filtered course list
 * @param {boolean} generateHtml
 * @param {boolean} generateTsv
 */
async function generateMatrixAndFaculty(
  studentId,
  targetConfig,
  allCourses,
  generateHtml,
  generateTsv,
) {
  const targetCodes = Object.keys(targetConfig);
  const studentCourses = allCourses.filter((course) =>
    targetCodes.includes(course.formal_code),
  );

  if (studentCourses.length === 0) {
    console.warn(
      `   ${colors.yellow}[Warning] No courses found for ID ${studentId}. Skipping generation.${colors.reset}\n`,
    );
    return;
  }

  if (generateTsv) {
    // Perform collision detection per student
    detectCollisions(studentId, studentCourses);

    // Generate student-specific faculty list
    try {
      const studentUniqueFaculties = new Map();
      for (const course of studentCourses) {
        for (const section of course.sections) {
          const facultyName = section.faculty_name || "";
          const facultyCode = section.faculty_code || "";
          if (
            facultyName &&
            facultyCode &&
            facultyName !== "TBA" &&
            facultyCode !== "TBA"
          ) {
            studentUniqueFaculties.set(facultyCode, facultyName);
          }
        }
      }

      const studentFacultyRows = ["Faculty Name\tFaculty Code"];
      const sortedStudentFaculties = Array.from(
        studentUniqueFaculties.entries(),
      ).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [code, name] of sortedStudentFaculties) {
        studentFacultyRows.push(`${name}\t${code}`);
      }

      const studentFacultyOutputFile = `${OUTPUT_DIR}/faculty/${studentId}.tsv`;
      await Bun.write(studentFacultyOutputFile, studentFacultyRows.join("\n"));
      console.log(
        `   * Saved faculty list to: ${colors.dim}${studentFacultyOutputFile}${colors.reset}`,
      );
    } catch (error) {
      console.error(
        `   ${colors.red}An error occurred during student faculty list generation:${colors.reset}\n`,
        error,
      );
    }
  }

  // Generate matrix and optionally write TSV/HTML
  try {
    const theoryCourses = [];
    const labCourses = [];

    for (const c of studentCourses) {
      const short =
        targetConfig[c.formal_code] || generateShortName(c.course_name);
      if (short.toLowerCase().endsWith("-lab")) {
        labCourses.push({ code: c.course_code, short });
      } else {
        theoryCourses.push({ code: c.course_code, short });
      }
    }

    theoryCourses.sort((a, b) => a.code.localeCompare(b.code));
    labCourses.sort((a, b) => a.code.localeCompare(b.code));

    const columns = [{ type: "time", groupName: "", courseShort: "TIME" }];

    for (let gIdx = 0; gIdx < DAY_GROUPS.length; gIdx++) {
      const group = DAY_GROUPS[gIdx];
      if (group.type === "none") {
        columns.push({
          type: "none",
          groupIndex: gIdx,
          groupName: group.name,
          courseShort: "xxx",
        });
      } else {
        const coursesInGroup =
          group.type === "theory" ? theoryCourses : labCourses;
        for (const c of coursesInGroup) {
          columns.push({
            type: group.type,
            groupIndex: gIdx,
            groupName: group.name,
            courseCode: c.code,
            courseShort: c.short,
          });
        }
      }
    }

    const allSlotRows = [];

    for (const time of TIME_SLOTS) {
      const colMatches = columns.map((col) => {
        if (col.type === "time") return [time];
        if (col.type === "none") return ["x"];
        const c = studentCourses.find(
          (cc) => cc.course_code === col.courseCode,
        );
        const matches = [];
        if (c) {
          const group = DAY_GROUPS[col.groupIndex];
          for (const section of c.sections) {
            if (isSectionStartingInSlot(section, time, group.days)) {
              matches.push(
                section.faculty_code
                  ? `${section.faculty_code}-${section.section_name}`
                  : section.section_name,
              );
            }
          }
        }
        return matches;
      });

      let maxMatches = 0;
      for (let i = 1; i < columns.length; i++) {
        if (columns[i].type !== "none" && colMatches[i].length > maxMatches)
          maxMatches = colMatches[i].length;
      }

      for (let rowIdx = 0; rowIdx < maxMatches; rowIdx++) {
        allSlotRows.push(
          columns.map((col, colIdx) => {
            if (col.type === "time") return rowIdx === 0 ? time : "";
            if (col.type === "none") return "x";
            return colMatches[colIdx][rowIdx] || "";
          }),
        );
      }
    }

    const activeColumnIndices = [0];
    for (let colIdx = 1; colIdx < columns.length; colIdx++) {
      if (columns[colIdx].type === "none") {
        activeColumnIndices.push(colIdx);
      } else if (
        allSlotRows.some((row) => row[colIdx] !== "" && row[colIdx] !== "x")
      ) {
        activeColumnIndices.push(colIdx);
      }
    }

    const activeColumns = activeColumnIndices.map((idx) => columns[idx]);
    const finalRows = [];

    // Header row 1: group names
    const headerRow1 = ["TIME"];
    let lastGroupName = null;
    for (let i = 1; i < activeColumns.length; i++) {
      const col = activeColumns[i];
      headerRow1.push(col.groupName !== lastGroupName ? col.groupName : "");
      lastGroupName = col.groupName;
    }
    finalRows.push(headerRow1);

    // Header row 2: course short names
    const headerRow2 = [""];
    for (let i = 1; i < activeColumns.length; i++)
      headerRow2.push(activeColumns[i].courseShort);
    finalRows.push(headerRow2);

    // Data rows
    for (const row of allSlotRows) {
      const filteredRow = activeColumnIndices.map((idx) => row[idx]);
      if (filteredRow.slice(1).some((val) => val !== "" && val !== "x")) {
        finalRows.push(filteredRow);
      }
    }

    if (generateTsv) {
      const studentOutputFile = `${OUTPUT_DIR}/displays/${studentId}.tsv`;
      await Bun.write(
        studentOutputFile,
        finalRows.map((r) => r.join("\t")).join("\n"),
      );
      console.log(
        `   * Saved schedule matrix to: ${colors.dim}${studentOutputFile}${colors.reset}`,
      );
    }

    if (generateHtml) {
      const studentHtmlOutputFile = `html/${studentId}.html`;
      await Bun.write(
        studentHtmlOutputFile,
        generateHtmlDisplay(studentId, activeColumns, finalRows),
      );
      console.log(
        `   * Saved HTML schedule matrix (with Google Sheets styling) to: ${colors.dim}${studentHtmlOutputFile}${colors.reset}`,
      );
    }
  } catch (error) {
    console.error(
      `   ${colors.red}An error occurred during display matrix generation:${colors.reset}\n`,
      error,
    );
  }
}

async function main() {
  console.log(
    `\n${colors.bright}${colors.cyan}Starting class plan processing pipeline...${colors.reset}\n`,
  );

  console.log(`${colors.cyan}Reading ${SECTION_FILE}...${colors.reset}`);
  let rawCourses = [];

  try {
    const file = Bun.file(SECTION_FILE);
    if (!(await file.exists())) {
      console.error(
        `${colors.red}Error: ${SECTION_FILE} not found. Please provide the file.${colors.reset}`,
      );
      return;
    }

    const data = await file.json();
    if (data && data.data && Array.isArray(data.data.courses)) {
      rawCourses = data.data.courses;
    } else {
      console.error(
        `${colors.red}Error: Unexpected JSON structure in res.json.${colors.reset}`,
      );
      return;
    }
  } catch (error) {
    console.error(
      `${colors.red}An error occurred during loading res.json:${colors.reset}`,
      error,
    );
    return;
  }

  // Load config of all people
  console.log(`${colors.cyan}Reading ${COURSES_CONFIG_FILE}...${colors.reset}`);
  let peopleConfigs = {};

  try {
    const configFile = Bun.file(COURSES_CONFIG_FILE);
    if (!(await configFile.exists())) {
      console.error(
        `${colors.red}Error: ${COURSES_CONFIG_FILE} not found. Please create it.${colors.reset}`,
      );
      return;
    }
    peopleConfigs = await configFile.json();
  } catch (error) {
    console.error(
      `${colors.red}Error: Failed to parse ${COURSES_CONFIG_FILE}:${colors.reset}`,
      error,
    );
    return;
  }

  const peopleIds = Object.keys(peopleConfigs);
  if (peopleIds.length === 0) {
    console.warn(
      `${colors.yellow}[Warning] No configurations found in ${COURSES_CONFIG_FILE}.${colors.reset}`,
    );
    return;
  }

  // Collect the union of all course codes across all students
  const unionTargetCodes = new Set();
  for (const studentId of peopleIds) {
    const targetCodes = Object.keys(peopleConfigs[studentId]);
    targetCodes.forEach((code) => unionTargetCodes.add(code));
  }

  // Filter unique courses
  const filteredCourses = rawCourses.filter((course) =>
    unionTargetCodes.has(course.formal_code),
  );

  console.log(
    `${colors.green}Filtering courses: found ${filteredCourses.length} unique courses across all configurations.${colors.reset}\n`,
  );

  // Generate course TSVs & faculty.tsv inside OUTPUT_DIR subfolders
  console.log(
    `${colors.cyan}Generating course TSVs & faculty list inside ${OUTPUT_DIR}/...${colors.reset}`,
  );
  try {
    // Ensure all subfolders exist
    await mkdir(`${OUTPUT_DIR}/courses`, { recursive: true });
    await mkdir(`${OUTPUT_DIR}/faculty`, { recursive: true });
    await mkdir(`${OUTPUT_DIR}/displays`, { recursive: true });
    await mkdir("html", { recursive: true });

    const uniqueFaculties = new Map();

    for (const course of filteredCourses) {
      course.sections.sort((a, b) =>
        a.section_name.localeCompare(b.section_name, undefined, {
          numeric: true,
        }),
      );

      const sectionRows = [];
      sectionRows.push("Section\tFaculty Code\tFaculty Name\tRoom\tDay\tTime");

      let firstSectionSeats = null;
      let seatWarningGiven = false;

      for (const section of course.sections) {
        if (firstSectionSeats === null) {
          firstSectionSeats = section.total_seats;
        } else if (
          firstSectionSeats !== section.total_seats &&
          !seatWarningGiven
        ) {
          console.warn(
            `   ${colors.yellow}[Warning] Course ${course.course_name} (${course.course_code}) has sections with differing total seats (${firstSectionSeats} vs ${section.total_seats})${colors.reset}`,
          );
          seatWarningGiven = true;
        }

        let facultyName = section.faculty_name || "";
        let facultyCode = section.faculty_code || "";

        if (
          !facultyName ||
          !facultyCode ||
          facultyName === "TBA" ||
          facultyCode === "TBA"
        ) {
          facultyName = "";
          facultyCode = "";
        } else {
          if (!uniqueFaculties.has(facultyCode)) {
            uniqueFaculties.set(facultyCode, facultyName);
          }
        }

        let displayDay = "";
        let displayTime = "";
        let hasError = false;

        if (section.schedule.length === 1) {
          const schedule = section.schedule[0];
          displayDay = schedule.day;
          displayTime = `${schedule.start_time} - ${schedule.end_time}`;
        } else if (section.schedule.length === 2) {
          const s1 = section.schedule[0];
          const s2 = section.schedule[1];

          const t1 = `${s1.start_time} - ${s1.end_time}`;
          const t2 = `${s2.start_time} - ${s2.end_time}`;

          if (t1 !== t2) {
            console.error(
              `      ${colors.red}[Error] Schedule anomaly: Times don't match for course ${course.course_code} section ${section.section_name}${colors.reset}`,
            );
            hasError = true;
          }

          const days = [s1.day, s2.day].sort();

          if (days[0] === "Saturday" && days[1] === "Tuesday") {
            displayDay = "Saturday";
          } else if (days[0] === "Sunday" && days[1] === "Wednesday") {
            displayDay = "Sunday";
          } else {
            console.error(
              `      ${colors.red}[Error] Schedule anomaly: Unexpected day pairing (${days.join(", ")}) for course ${course.course_code} section ${section.section_name}. Expected Sat+Tue or Sun+Wed.${colors.reset}`,
            );
            hasError = true;
          }

          displayTime = t1;
        } else {
          console.error(
            `      ${colors.red}[Error] Schedule anomaly: Unexpected number of days (${section.schedule.length}) for course ${course.course_code} section ${section.section_name}.${colors.reset}`,
          );
          hasError = true;
        }

        if (hasError) {
          displayDay = section.schedule.map((s) => s.day).join(" / ");
          displayTime = section.schedule
            .map((s) => `${s.start_time}-${s.end_time}`)
            .join(" / ");
        }

        const dayCheck = displayDay.toLowerCase();
        if (
          dayCheck.includes("monday") ||
          dayCheck.includes("thursday") ||
          dayCheck.includes("friday")
        ) {
          console.warn(
            `      ${colors.yellow}[Warning] Course ${course.course_name} (${course.course_code}) section ${section.section_name} is scheduled on a Monday, Thursday, or Friday: ${displayDay}${colors.reset}`,
          );
        }

        displayDay = displayDay
          .replace(/Saturday/gi, "sat")
          .replace(/Sunday/gi, "sun")
          .replace(/Monday/gi, "mon")
          .replace(/Tuesday/gi, "tue")
          .replace(/Wednesday/gi, "wed")
          .replace(/Thursday/gi, "thu")
          .replace(/Friday/gi, "fri");

        const roomMatch = (section.room_details || "").match(/^\d+/);
        const room = roomMatch ? roomMatch[0] : "";
        const row = [
          section.section_name,
          facultyCode,
          facultyName,
          room,
          displayDay,
          displayTime,
        ].join("\t");

        sectionRows.push(row);
      }

      const safeName = safeFileName(course.course_name);
      const courseFileName = `${OUTPUT_DIR}/courses/${safeName}.tsv`;
      await Bun.write(courseFileName, sectionRows.join("\n"));
      console.log(
        `   * Saved sections list to: ${colors.dim}${courseFileName}${colors.reset}`,
      );
    }

    const facultyRows = ["Faculty Name\tFaculty Code"];
    const sortedFaculties = Array.from(uniqueFaculties.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    for (const [code, name] of sortedFaculties) {
      facultyRows.push(`${name}\t${code}`);
    }

    await Bun.write(FACULTY_FILE, facultyRows.join("\n"));
    console.log(
      `   * Saved combined faculty list to: ${colors.dim}${FACULTY_FILE}${colors.reset}\n`,
    );
  } catch (error) {
    console.error(
      `${colors.red}An error occurred during TSV generation:${colors.reset}\n`,
      error,
    );
    return;
  }

  // Group students by their course signature (sorted list of course codes)
  const groupedConfigs = new Map();
  const nameDiscrepancies = [];

  for (const studentId of peopleIds) {
    const targetConfig = peopleConfigs[studentId];
    const sortedCodes = Object.keys(targetConfig).sort();
    const sig = sortedCodes.join(",");
    if (!groupedConfigs.has(sig)) {
      groupedConfigs.set(sig, []);
    }
    groupedConfigs.get(sig).push(studentId);
  }

  // Check for different names for the same course across all configurations
  const courseNameToStudents = new Map();
  for (const studentId of peopleIds) {
    for (const [code, name] of Object.entries(peopleConfigs[studentId])) {
      if (!courseNameToStudents.has(code)) {
        courseNameToStudents.set(code, []);
      }
      courseNameToStudents.get(code).push({ name, studentId });
    }
  }

  for (const [code, entries] of courseNameToStudents.entries()) {
    const uniqueNames = Array.from(new Set(entries.map((e) => e.name)));
    if (uniqueNames.length > 1) {
      nameDiscrepancies.push({
        code,
        names: entries.map((e) => `${e.name} (${e.studentId})`),
      });
    }
  }

  // Generate TSVs for every student ID individually
  for (const studentId of peopleIds) {
    console.log(
      `${colors.bright}${colors.cyan}--- Generating matrix & faculty (TSVs) for ID: ${studentId} ---${colors.reset}`,
    );
    await generateMatrixAndFaculty(
      studentId,
      peopleConfigs[studentId],
      filteredCourses,
      false,
      true,
    );
    console.log("");
  }

  // Generate HTML for unique/grouped configurations
  console.log(
    `${colors.bright}${colors.cyan}--- Generating HTML Schedule Matrices ---${colors.reset}`,
  );
  for (const [, studentIds] of groupedConfigs.entries()) {
    studentIds.sort();
    const studentId = studentIds.join("+");
    const targetConfig = peopleConfigs[studentIds[0]];
    await generateMatrixAndFaculty(
      studentId,
      targetConfig,
      filteredCourses,
      true,
      false,
    );
    console.log("");
  }

  // Step 4: Verification of global files
  await validateOutputs(filteredCourses);

  if (nameDiscrepancies.length > 0) {
    console.log(
      `\n${colors.bright}${colors.yellow}Course Name Discrepancies in Configurations:${colors.reset}`,
    );
    for (const discrepancy of nameDiscrepancies) {
      console.warn(
        `   ${colors.yellow}[Warning] Course ${discrepancy.code} has different names: ${discrepancy.names.join(" vs ")}${colors.reset}`,
      );
    }
    console.log("");
  }

  console.log(
    `${colors.bright}${colors.green}All processing successfully completed!${colors.reset}\n`,
  );
}

main();
