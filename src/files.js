import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { today, lastNDates, sprintWeek } from './dates.js';

const TOTAL_BIBLE_CHAPTERS = 1189;

// ---------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------

export function dataPath(name) {
  return path.join(config.dataDir, name);
}

export function readFileOr(name, fallback = '') {
  const p = dataPath(name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallback;
}

export function writeFileData(name, content) {
  fs.writeFileSync(dataPath(name), content, 'utf8');
}

export function dailyLogName(dateStr = today()) {
  return `daily-log-${dateStr}.md`;
}

/** Create today's daily log from the template if it doesn't exist yet. */
export function ensureDailyLog(dateStr = today()) {
  const name = dailyLogName(dateStr);
  const p = dataPath(name);
  if (!fs.existsSync(p)) {
    const template = readFileOr('daily-log-template.md');
    const seeded = template.replace('# Daily Log — [DATE]', `# Daily Log — ${dateStr}`);
    fs.writeFileSync(p, seeded, 'utf8');
  }
  return name;
}

// ---------------------------------------------------------------------------
// Pure transforms (exported for unit tests)
// ---------------------------------------------------------------------------

function replaceLine(lines, startsWith, makeLine) {
  const i = lines.findIndex((l) => l.trimStart().startsWith(startsWith));
  if (i === -1) return false;
  lines[i] = makeLine(lines[i]);
  return true;
}

function num(str) {
  const m = String(str).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Apply a set of parsed fields to a daily-log markdown string.
 * Prayer minutes and Bible chapters accumulate across the day; most other
 * fields are last-writer-wins. Only fields that are non-null are touched.
 */
export function applyDailyUpdate(content, fields) {
  const lines = content.split('\n');
  const f = fields || {};

  const has = (k) => f[k] !== undefined && f[k] !== null && f[k] !== '';

  if (has('day_type')) {
    replaceLine(lines, '**Day type:**', () => `**Day type:** ${f.day_type}`);
  }

  if (has('prayer_minutes')) {
    replaceLine(lines, '- Prayer:', (old) => {
      const prev = num(old.replace(/\(150 target\)/, '')) || 0;
      return `- Prayer: ${prev + Number(f.prayer_minutes)} min (150 target)`;
    });
  }

  if (has('bible_chapters') || has('bible_reached')) {
    replaceLine(lines, '- Bible:', (old) => {
      const prevCh = num((old.match(/chapters read today:\s*([\d]+)/) || [])[1]) || 0;
      const prevReached = (old.match(/book\/chapter reached:\s*(.*)$/) || [])[1] || '___';
      const ch = has('bible_chapters') ? prevCh + Number(f.bible_chapters) : prevCh;
      const reached = has('bible_reached') ? f.bible_reached : prevReached;
      return `- Bible: chapters read today: ${ch} &nbsp;|&nbsp; book/chapter reached: ${reached}`;
    });
  }

  if (has('exercise_rest') && f.exercise_rest === true) {
    replaceLine(lines, '- Exercise:', () => `- Exercise: rest day (Sabbath)`);
  } else if (has('exercise_type') || has('exercise_duration')) {
    replaceLine(
      lines,
      '- Exercise:',
      () =>
        `- Exercise: type ${f.exercise_type || '___'} &nbsp; duration ${
          f.exercise_duration || '___'
        } &nbsp;`,
    );
  }

  if (has('donothing')) {
    replaceLine(lines, '- Do-nothing 30min:', () => `- Do-nothing 30min: done? ${f.donothing ? 'Y' : 'N'}`);
  }

  if (has('sleep_hours') || has('sleep_quality')) {
    replaceLine(lines, '- Sleep last night:', (old) => {
      const prevH = (old.match(/last night:\s*([\d.]+)/) || [])[1] || '___';
      const prevQ = (old.match(/quality \(1–5\):\s*([\d]+)/) || [])[1] || '___';
      const h = has('sleep_hours') ? f.sleep_hours : prevH;
      const q = has('sleep_quality') ? f.sleep_quality : prevQ;
      return `- Sleep last night: ${h} hrs &nbsp; quality (1–5): ${q}`;
    });
  }

  if (has('block1_target')) replaceLine(lines, '- Block 1 target', () => `- Block 1 target (stated before starting): ${f.block1_target}`);
  if (has('block1_status')) replaceLine(lines, '- Block 1 — done?', () => `- Block 1 — done? ${f.block1_status}`);
  if (has('block2_target')) replaceLine(lines, '- Block 2 target:', () => `- Block 2 target: ${f.block2_target}`);
  if (has('block2_status')) replaceLine(lines, '- Block 2 — done?', () => `- Block 2 — done? ${f.block2_status}`);
  if (has('block3')) replaceLine(lines, '- (Block 3 if applicable):', () => `- (Block 3 if applicable): ${f.block3}`);

  if (has('orgA_progress')) appendAfterLabel(lines, '- Org A outcome progress:', f.orgA_progress);
  if (has('orgB_progress')) appendAfterLabel(lines, '- Org B outcome progress:', f.orgB_progress);

  if (has('weight_kg')) replaceLine(lines, '- Weight (weekly only', () => `- Weight (weekly only, leave blank most days): ${f.weight_kg}`);
  if (has('eating')) replaceLine(lines, '- Eating:', () => `- Eating: ${f.eating}`);
  if (has('socialization')) replaceLine(lines, '- Socialization today:', () => `- Socialization today: ${f.socialization}`);
  if (has('learning')) replaceLine(lines, '- Learning:', () => `- Learning: ${f.learning}`);
  if (has('went_well')) appendAfterLabel(lines, '- One thing that went well:', f.went_well);
  if (has('slipped')) appendAfterLabel(lines, '- One thing that slipped:', f.slipped);

  return lines.join('\n');
}

function appendAfterLabel(lines, startsWith, value) {
  replaceLine(lines, startsWith, (old) => {
    const [label, ...rest] = old.split(':');
    const existing = rest.join(':').trim();
    const combined = existing && existing !== '' ? `${existing}; ${value}` : ` ${value}`;
    return `${label}:${combined.startsWith(' ') ? '' : ' '}${combined}`;
  });
}

/** Update bible.md: bump the chapter count and (optionally) check off finished books. */
export function applyBibleUpdate(content, { chapters = 0, booksFinished = [] } = {}) {
  let out = content;

  if (chapters) {
    out = out.replace(/Chapters completed:\s*([\d_]+)\s*\/\s*1189\s*\(([\d_.%]*)\)/, (_m, done) => {
      const prev = /^\d+$/.test(done) ? Number(done) : 0;
      const total = prev + Number(chapters);
      const pct = ((total / TOTAL_BIBLE_CHAPTERS) * 100).toFixed(1);
      return `Chapters completed: ${total} / 1189 (${pct}%)`;
    });
    out = out.replace(/Last updated:.*/g, `Last updated: ${today()}`);
  }

  for (const book of booksFinished || []) {
    const name = String(book).trim();
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match "- [ ] Genesis (50)" (checkbox may already be checked — skip then).
    const re = new RegExp(`- \\[ \\] (${esc}) \\(`, 'i');
    out = out.replace(re, (m) => m.replace('[ ]', '[x]'));
  }

  return out;
}

/** Update fitness.md weekly weight table for a given sprint week. */
export function applyFitnessWeight(content, { week, date, weightKg }) {
  const lines = content.split('\n');
  // Rows look like: "| 1 | | | | |" or "| 0 (baseline) | | | | |"
  const re = new RegExp(`^\\|\\s*${week}\\b`);
  const i = lines.findIndex((l) => re.test(l.trim()));
  if (i !== -1) {
    lines[i] = `| ${week} | ${date} | ${weightKg} |  |  |`;
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reading stats back out
// ---------------------------------------------------------------------------

/** Pull the numeric fields out of one daily-log file's contents. */
export function parseDaily(content) {
  const pick = (re) => {
    const m = content.match(re);
    return m ? m[1] : null;
  };
  const prayer = pick(/- Prayer:\s*(\d+)\s*min/);
  const exerciseLine = (content.match(/- Exercise:.*/) || [''])[0];
  const exercised =
    /rest day/i.test(exerciseLine) === false &&
    /- Exercise: type\s+(?!___)([^\s].*?)(&nbsp;|$)/.test(exerciseLine);
  const socialLine = ((content.match(/- Socialization today:\s*(.*)/) || [, ''])[1] || '').trim();
  // Ignore the unfilled template default ("Y/N — with whom/what:"); count a real
  // "Y"/"yes" or any descriptive phrase, but not "N"/"no".
  const social =
    socialLine !== '' &&
    !socialLine.startsWith('Y/N') &&
    !/^n(o)?\b/i.test(socialLine);
  // "done? Y" counts; the template default "done? Y/N" (Y followed by "/") does not.
  const donothing = /- Do-nothing 30min: done\?\s*Y(?!\/)/i.test(content);

  return {
    prayerMinutes: prayer !== null ? Number(prayer) : null,
    bibleChapters: (() => {
      const v = pick(/chapters read today:\s*(\d+)/);
      return v !== null ? Number(v) : null;
    })(),
    exercised,
    social,
    donothing,
    sleepHours: (() => {
      const v = pick(/Sleep last night:\s*([\d.]+)\s*hrs/);
      return v !== null ? Number(v) : null;
    })(),
    weightKg: (() => {
      const v = pick(/- Weight \(weekly only[^:]*:\s*([\d.]+)/);
      return v !== null ? Number(v) : null;
    })(),
  };
}

/** Load the daily-log contents for a list of dates that exist on disk. */
export function loadDailies(dates) {
  return dates
    .map((d) => ({ date: d, content: readFileOr(dailyLogName(d), null) }))
    .filter((x) => x.content !== null);
}

/** Aggregate a set of parsed daily logs into weekly-style stats. */
export function aggregate(dailies) {
  const parsed = dailies.map((d) => ({ date: d.date, ...parseDaily(d.content) }));
  const prayerVals = parsed.map((p) => p.prayerMinutes).filter((v) => v !== null);
  const sleepVals = parsed.map((p) => p.sleepHours).filter((v) => v !== null);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  return {
    daysLogged: parsed.length,
    prayerAvg: avg(prayerVals),
    prayerDaysLogged: prayerVals.length,
    exerciseDays: parsed.filter((p) => p.exercised).length,
    socialCount: parsed.filter((p) => p.social).length,
    donothingDays: parsed.filter((p) => p.donothing).length,
    sleepAvg: avg(sleepVals),
    bibleChaptersWeek: parsed.reduce((a, p) => a + (p.bibleChapters || 0), 0),
  };
}

/** Bible progress { completed, pct } read from bible.md. */
export function bibleProgress() {
  const content = readFileOr('bible.md');
  const m = content.match(/Chapters completed:\s*(\d+)\s*\/\s*1189/);
  const completed = m ? Number(m[1]) : 0;
  return { completed, pct: ((completed / TOTAL_BIBLE_CHAPTERS) * 100).toFixed(1) };
}

/** Latest recorded weight from fitness.md weight table (most recent filled row). */
export function latestWeight() {
  const content = readFileOr('fitness.md');
  let latest = null;
  for (const line of content.split('\n')) {
    const m = line.match(/^\|\s*[\w() ]+\|\s*[\d-]+\s*\|\s*([\d.]+)\s*\|/);
    if (m) latest = Number(m[1]);
  }
  return latest;
}

// ---------------------------------------------------------------------------
// High-level: apply a parsed message to all relevant files
// ---------------------------------------------------------------------------

/**
 * Apply Claude's parsed fields to today's daily log and the running trackers.
 * Returns the list of file names that were written.
 */
export function applyParsedUpdate(fields, dateStr = today()) {
  const written = new Set();

  const name = ensureDailyLog(dateStr);
  const daily = readFileOr(name);
  const updatedDaily = applyDailyUpdate(daily, fields);
  if (updatedDaily !== daily) {
    writeFileData(name, updatedDaily);
    written.add(name);
  }

  // Bible tracker
  if (fields.bible_chapters || (fields.bible_books_finished && fields.bible_books_finished.length)) {
    const bible = readFileOr('bible.md');
    const updatedBible = applyBibleUpdate(bible, {
      chapters: fields.bible_chapters || 0,
      booksFinished: fields.bible_books_finished || [],
    });
    if (updatedBible !== bible) {
      writeFileData('bible.md', updatedBible);
      written.add('bible.md');
    }
  }

  // Fitness weight row (weekly weigh-in)
  if (fields.weight_kg) {
    const week = sprintWeek(dateStr);
    if (week !== null) {
      const fit = readFileOr('fitness.md');
      const updatedFit = applyFitnessWeight(fit, { week, date: dateStr, weightKg: fields.weight_kg });
      if (updatedFit !== fit) {
        writeFileData('fitness.md', updatedFit);
        written.add('fitness.md');
      }
    }
  }

  return [...written];
}
