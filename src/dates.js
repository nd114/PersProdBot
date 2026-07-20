// Date helpers. All dates are local to the host timezone (set TZ to control it).

// The 90-day sprint window, from README.md / goals.md.
export const SPRINT_START = '2026-07-20'; // Day 1, Monday

/** Local YYYY-MM-DD for a Date (defaults to now). */
export function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today as YYYY-MM-DD. */
export function today() {
  return ymd();
}

/** The last `n` calendar dates ending today, oldest first. */
export function lastNDates(n, from = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}

/** Sprint week number (1-based) for a given date, or null if before the sprint. */
export function sprintWeek(dateStr = today()) {
  const start = new Date(`${SPRINT_START}T00:00:00`);
  const d = new Date(`${dateStr}T00:00:00`);
  const days = Math.floor((d - start) / 86_400_000);
  if (days < 0) return null;
  return Math.floor(days / 7) + 1;
}

/** A human weekday name, e.g. "Thursday". */
export function weekdayName(dateStr = today()) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
  });
}

/** The day-type label from schedule.md, fixed by day of week -- never guessed. */
export function dayType(dateStr = today()) {
  const day = new Date(`${dateStr}T00:00:00`).getDay(); // 0=Sun ... 6=Sat
  if (day === 4) return 'Sabbath (Thu)';
  if (day === 6) return 'Saturday';
  if (day === 0) return 'Sunday';
  return 'Work day';
}
