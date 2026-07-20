import fs from 'node:fs';
import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { today, lastNDates, sprintWeek, weekdayName } from './dates.js';
import {
  ensureDailyLog,
  applyParsedUpdate,
  loadDailies,
  aggregate,
  bibleProgress,
  latestWeight,
  readFileOr,
  writeFileData,
  dataPath,
  seedDataDirIfEmpty,
} from './files.js';
import { parseMessage, hasUpdates, generateReview } from './claude.js';
import { autoCommit } from './git.js';

// Seed an external DATA_DIR (e.g. a fresh, empty Railway volume) from the
// bundled starter files before anything tries to read from it.
seedDataDirIfEmpty();

const bot = new TelegramBot(config.telegramToken, { polling: true });

// --- access control -------------------------------------------------------
function allowed(msg) {
  if (!config.allowedChatId) return true;
  return String(msg.chat.id) === config.allowedChatId;
}

// --- helpers --------------------------------------------------------------
async function sendLong(chatId, text) {
  const LIMIT = 3900;
  for (let i = 0; i < text.length; i += LIMIT) {
    await bot.sendMessage(chatId, text.slice(i, i + LIMIT));
  }
}

function listDailyLogFiles() {
  return fs
    .readdirSync(config.dataDir)
    .filter((n) => /^daily-log-\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .sort();
}

function statusText() {
  const week = lastNDates(7);
  const dailies = loadDailies(week);
  const stats = aggregate(dailies);
  const bible = bibleProgress();
  const weight = latestWeight();

  const prayer =
    stats.prayerAvg !== null ? `${Math.round(stats.prayerAvg)} min/day avg (target 150)` : 'no entries yet';
  const sleep = stats.sleepAvg !== null ? `${stats.sleepAvg.toFixed(1)} hrs avg` : 'no entries';
  const weightLine =
    weight !== null ? `${weight} kg (target 75kg, ${(weight - 75).toFixed(1)} to go)` : 'not recorded yet';

  return [
    `📊 Snapshot — ${today()} (${weekdayName()})`,
    ``,
    `Bible: ${bible.completed}/1189 (${bible.pct}%)`,
    `Prayer (last 7d): ${prayer}`,
    `Exercise (last 7d): ${stats.exerciseDays}/6 days`,
    `Socialization (last 7d): ${stats.socialCount} block(s)`,
    `Do-nothing (last 7d): ${stats.donothingDays}/7`,
    `Sleep (last 7d): ${sleep}`,
    `Weight: ${weightLine}`,
    ``,
    `(${stats.daysLogged} day(s) logged this window)`,
  ].join('\n');
}

// --- commands -------------------------------------------------------------
const HELP = [
  '90-Day Sprint logging bot. Just text me what you did and I file it -- e.g.',
  '  "did 45 min prayer this morning"',
  '  "read 14 chapters, reached Exodus 12"',
  '  "weighed in at 81.5"',
  '  "skipped exercise, back\'s sore"',
  '',
  'Commands:',
  '/status -- quick snapshot (Bible %, prayer avg, exercise days, weight)',
  '/review -- fill this week\'s review from the last 7 daily logs',
  '/month -- fill the monthly review from the sprint so far',
  '/help -- this message',
].join('\n');

bot.onText(/^\/(start|help)\b/, (msg) => {
  if (!allowed(msg)) return;
  bot.sendMessage(msg.chat.id, HELP);
});

bot.onText(/^\/status\b/, async (msg) => {
  if (!allowed(msg)) return;
  try {
    await bot.sendMessage(msg.chat.id, statusText());
  } catch (err) {
    console.error('[/status]', err);
    await bot.sendMessage(msg.chat.id, '⚠️ Could not build the snapshot -- check the bot logs.');
  }
});

bot.onText(/^\/(review|week)\b/, async (msg) => {
  if (!allowed(msg)) return;
  await runReview(msg.chat.id, 'weekly');
});

bot.onText(/^\/month\b/, async (msg) => {
  if (!allowed(msg)) return;
  await runReview(msg.chat.id, 'monthly');
});

async function runReview(chatId, kind) {
  try {
    await bot.sendMessage(chatId, `Working on your ${kind} review…`);

    let dailies;
    let templateName;
    let outName;
    if (kind === 'weekly') {
      dailies = loadDailies(lastNDates(7));
      templateName = 'weekly-review-template.md';
      const week = sprintWeek() ?? '?';
      outName = `weekly-review-week-${week}-${today()}.md`;
    } else {
      dailies = listDailyLogFiles().map((n) => ({
        date: n.replace(/^daily-log-|\.md$/g, ''),
        content: readFileOr(n),
      }));
      templateName = 'monthly-review-template.md';
      outName = `monthly-review-${today().slice(0, 7)}.md`;
    }

    if (dailies.length === 0) {
      await bot.sendMessage(chatId, 'No daily logs found yet, so there\'s nothing to review. Text me some updates first.');
      return;
    }

    const stats = aggregate(dailies);
    const review = await generateReview({
      kind,
      template: readFileOr(templateName),
      dailies,
      stats,
      goals: readFileOr('goals.md'),
      bible: bibleProgress(),
      weight: latestWeight(),
    });

    writeFileData(outName, review);
    await autoCommit(`${kind} review ${outName}`);
    await sendLong(chatId, review);
    await bot.sendMessage(chatId, `Saved as ${outName} ✅`);
  } catch (err) {
    console.error(`[/${kind} review]`, err);
    await bot.sendMessage(chatId, '⚠️ Could not build the review -- check the bot logs.');
  }
}

// --- free-text logging ----------------------------------------------------
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return; // commands handled above
  console.log(`[msg] chat ${msg.chat.id}: ${msg.text}`);
  if (!allowed(msg)) {
    await bot.sendMessage(msg.chat.id, 'This bot is private.');
    return;
  }

  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, 'typing');
    const dateStr = today();
    console.log('[msg] asking Claude to parse...');
    const parsed = await parseMessage(msg.text, dateStr);
    console.log('[msg] got parsed result:', JSON.stringify(parsed));

    if (!hasUpdates(parsed)) {
      const q = parsed.clarification_needed || "I couldn't tell what to log from that -- can you add a bit more detail (and any numbers)?";
      console.log('[msg] nothing to log, asking for clarification');
      await bot.sendMessage(chatId, q);
      console.log('[msg] clarification sent');
      return;
    }

    ensureDailyLog(dateStr);
    const written = applyParsedUpdate(parsed, dateStr);
    console.log('[msg] wrote files:', written);
    await autoCommit(`log ${dateStr}: ${parsed.confirmation || 'update'}`);

    let reply = parsed.confirmation ? `Logged: ${parsed.confirmation} ✅` : 'Logged ✅';
    if (parsed.clarification_needed) reply += `\n\n${parsed.clarification_needed}`;
    if (written.length === 0) reply += '\n(No tracker file changed -- nothing matched.)';
    console.log('[msg] sending reply to Telegram...');
    await bot.sendMessage(chatId, reply);
    console.log('[msg] reply sent successfully');
  } catch (err) {
    console.error('[message] ERROR:', err);
    await bot.sendMessage(chatId, '⚠️ Something went wrong logging that -- check the bot logs.');
  }
});

// --- optional daily reminder ---------------------------------------------
function scheduleDailyReminder() {
  if (!config.dailyReminderTime) return;
  const m = config.dailyReminderTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    console.warn(`[reminder] DAILY_REMINDER_TIME "${config.dailyReminderTime}" is not HH:MM -- skipping.`);
    return;
  }
  if (!config.allowedChatId) {
    console.warn('[reminder] DAILY_REMINDER_TIME is set but ALLOWED_CHAT_ID is not -- cannot target a chat, skipping.');
    return;
  }
  const [, hh, mm] = m;

  const fire = async () => {
    try {
      await bot.sendMessage(config.allowedChatId, `🌙 Evening check-in -- anything to log for ${today()}? (/status for a snapshot)`);
    } catch (err) {
      console.error('[reminder]', err);
    }
    scheduleNext();
  };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(Number(hh), Number(mm), 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(fire, next - now);
    console.log(`[reminder] next nudge at ${next.toLocaleString()}`);
  };

  scheduleNext();
}

// --- startup --------------------------------------------------------------
bot.on('polling_error', (err) => console.error('[polling]', err.message));

if (!fs.existsSync(dataPath('daily-log-template.md'))) {
  console.error(`No daily-log-template.md in DATA_DIR (${config.dataDir}). Is DATA_DIR pointing at the project files?`);
  process.exit(1);
}

scheduleDailyReminder();
console.log(`sprint90 bot online. Model=${config.model} Data=${config.dataDir}`);
console.log(config.allowedChatId ? `Locked to chat ${config.allowedChatId}.` : 'Open to any chat (set ALLOWED_CHAT_ID to lock it down).');
