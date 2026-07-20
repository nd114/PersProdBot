import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.js requires env vars; set dummies so importing files.js doesn't exit.
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.ANTHROPIC_API_KEY = 'test-key';

const {
  applyDailyUpdate,
  applyBibleUpdate,
  applyFitnessWeight,
  parseDaily,
  aggregate,
} = await import('../src/files.js');

const TEMPLATE = `# Daily Log — 2026-07-20

**Day type:** Work day / Saturday / Sunday / Sabbath (Thu)

## Anchors
- Prayer: ___ min (150 target)
- Bible: chapters read today: ___ &nbsp;|&nbsp; book/chapter reached: ___
- Exercise: type ___ &nbsp; duration ___ &nbsp; (rest day if Thu)
- Do-nothing 30min: done? Y/N
- Sleep last night: ___ hrs &nbsp; quality (1–5): ___

## Work (skip on Sun/Thu)
- Block 1 target (stated before starting):
- Block 1 — done? Y / partial / N
- Block 2 target:
- Block 2 — done? Y / partial / N
- (Block 3 if applicable):
- Org A outcome progress:
- Org B outcome progress:

## Body
- Weight (weekly only, leave blank most days): ___
- Eating: on-plan / off-plan — notes:

## Other
- Socialization today: Y/N — with whom/what:
- Learning: anything read/watched today:
- One thing that went well:
- One thing that slipped:`;

test('fills prayer minutes', () => {
  const out = applyDailyUpdate(TEMPLATE, { prayer_minutes: 45 });
  assert.match(out, /- Prayer: 45 min \(150 target\)/);
});

test('accumulates prayer minutes across two updates', () => {
  let out = applyDailyUpdate(TEMPLATE, { prayer_minutes: 45 });
  out = applyDailyUpdate(out, { prayer_minutes: 30 });
  assert.match(out, /- Prayer: 75 min \(150 target\)/);
});

test('fills and accumulates bible chapters and keeps reached', () => {
  let out = applyDailyUpdate(TEMPLATE, { bible_chapters: 14, bible_reached: 'Exodus 12' });
  assert.match(out, /chapters read today: 14 &nbsp;\|&nbsp; book\/chapter reached: Exodus 12/);
  out = applyDailyUpdate(out, { bible_chapters: 5 });
  assert.match(out, /chapters read today: 19 &nbsp;\|&nbsp; book\/chapter reached: Exodus 12/);
});

test('exercise rest day', () => {
  const out = applyDailyUpdate(TEMPLATE, { exercise_rest: true });
  assert.match(out, /- Exercise: rest day \(Sabbath\)/);
});

test('exercise type + duration', () => {
  const out = applyDailyUpdate(TEMPLATE, { exercise_type: 'strength', exercise_duration: '40 min' });
  assert.match(out, /- Exercise: type strength &nbsp; duration 40 min/);
});

test('sleep keeps the untouched half', () => {
  let out = applyDailyUpdate(TEMPLATE, { sleep_hours: 7 });
  assert.match(out, /- Sleep last night: 7 hrs &nbsp; quality \(1–5\): ___/);
  out = applyDailyUpdate(out, { sleep_quality: 4 });
  assert.match(out, /- Sleep last night: 7 hrs &nbsp; quality \(1–5\): 4/);
});

test('donothing yes/no', () => {
  assert.match(applyDailyUpdate(TEMPLATE, { donothing: true }), /- Do-nothing 30min: done\? Y/);
  assert.match(applyDailyUpdate(TEMPLATE, { donothing: false }), /- Do-nothing 30min: done\? N/);
});

test('work blocks and org progress', () => {
  const out = applyDailyUpdate(TEMPLATE, {
    block1_target: 'ship the report',
    block1_status: 'Y',
    orgA_progress: 'contract sent',
  });
  assert.match(out, /- Block 1 target \(stated before starting\): ship the report/);
  assert.match(out, /- Block 1 — done\? Y/);
  assert.match(out, /- Org A outcome progress: contract sent/);
});

test('org progress appends across updates', () => {
  let out = applyDailyUpdate(TEMPLATE, { orgA_progress: 'contract sent' });
  out = applyDailyUpdate(out, { orgA_progress: 'hire started' });
  assert.match(out, /- Org A outcome progress: contract sent; hire started/);
});

test('body + other fields', () => {
  const out = applyDailyUpdate(TEMPLATE, {
    weight_kg: 81.5,
    eating: 'on-plan',
    socialization: 'dinner with friends',
    learning: 'read a chapter of Deep Work',
    went_well: 'focused morning',
    slipped: 'late lunch',
  });
  assert.match(out, /- Weight \(weekly only, leave blank most days\): 81.5/);
  assert.match(out, /- Eating: on-plan/);
  assert.match(out, /- Socialization today: dinner with friends/);
  assert.match(out, /- Learning: read a chapter of Deep Work/);
  assert.match(out, /- One thing that went well: focused morning/);
  assert.match(out, /- One thing that slipped: late lunch/);
});

test('null fields leave the template untouched', () => {
  const out = applyDailyUpdate(TEMPLATE, { prayer_minutes: null, weight_kg: null });
  assert.equal(out, TEMPLATE);
});

// --- bible.md -------------------------------------------------------------
const BIBLE = `## Progress
Chapters completed: ___ / 1189 (___%)
Last updated:

- [ ] Genesis (50) &nbsp; - [ ] Exodus (40) &nbsp; - [ ] Leviticus (27)`;

test('bible progress increments and computes percent', () => {
  let out = applyBibleUpdate(BIBLE, { chapters: 50 });
  assert.match(out, /Chapters completed: 50 \/ 1189 \(4.2%\)/);
  out = applyBibleUpdate(out, { chapters: 40 });
  assert.match(out, /Chapters completed: 90 \/ 1189 \(7.6%\)/);
});

test('bible checks off finished books, including numbered ones', () => {
  const out = applyBibleUpdate(BIBLE, { chapters: 50, booksFinished: ['Genesis'] });
  assert.match(out, /- \[x\] Genesis \(50\)/);
  assert.match(out, /- \[ \] Exodus \(40\)/);
});

// --- fitness.md -----------------------------------------------------------
const FITNESS = `| Week | Date | Weight (kg) | Waist (cm, optional) | Notes |
|---|---|---|---|---|
| 0 (baseline) | | | | |
| 1 | | | | |
| 2 | | | | |`;

test('fitness weight fills the right week row', () => {
  const out = applyFitnessWeight(FITNESS, { week: 1, date: '2026-07-26', weightKg: 81.5 });
  assert.match(out, /\| 1 \| 2026-07-26 \| 81.5 \|/);
  assert.match(out, /\| 2 \| \| \| \| \|/); // week 2 untouched
});

// --- reading back ---------------------------------------------------------
test('parseDaily extracts values', () => {
  let d = applyDailyUpdate(TEMPLATE, {
    prayer_minutes: 150,
    bible_chapters: 13,
    exercise_type: 'run',
    exercise_duration: '30 min',
    donothing: true,
    sleep_hours: 7.5,
    weight_kg: 80,
    socialization: 'yes',
  });
  const p = parseDaily(d);
  assert.equal(p.prayerMinutes, 150);
  assert.equal(p.bibleChapters, 13);
  assert.equal(p.exercised, true);
  assert.equal(p.donothing, true);
  assert.equal(p.sleepHours, 7.5);
  assert.equal(p.weightKg, 80);
  assert.equal(p.social, true);
});

test('parseDaily marks rest day as not exercised', () => {
  const d = applyDailyUpdate(TEMPLATE, { exercise_rest: true });
  assert.equal(parseDaily(d).exercised, false);
});

test('parseDaily does not count untouched template defaults', () => {
  const p = parseDaily(TEMPLATE);
  assert.equal(p.social, false); // "Socialization today: Y/N — with whom/what:"
  assert.equal(p.donothing, false); // "Do-nothing 30min: done? Y/N"
  assert.equal(p.exercised, false);
  assert.equal(p.prayerMinutes, null);
  assert.equal(p.weightKg, null);
});

test('parseDaily counts a real "Y" for donothing but not "N"', () => {
  assert.equal(parseDaily(applyDailyUpdate(TEMPLATE, { donothing: true })).donothing, true);
  assert.equal(parseDaily(applyDailyUpdate(TEMPLATE, { donothing: false })).donothing, false);
});

test('aggregate averages and counts', () => {
  const d1 = applyDailyUpdate(TEMPLATE, { prayer_minutes: 100, exercise_type: 'run', exercise_duration: '20' });
  const d2 = applyDailyUpdate(TEMPLATE, { prayer_minutes: 200, exercise_rest: true });
  const stats = aggregate([
    { date: '2026-07-20', content: d1 },
    { date: '2026-07-21', content: d2 },
  ]);
  assert.equal(stats.prayerAvg, 150);
  assert.equal(stats.exerciseDays, 1);
  assert.equal(stats.daysLogged, 2);
});
