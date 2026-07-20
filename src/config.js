import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
  return v;
}

// The bundled starter files shipped in the repo (templates, goals, etc.) -- also
// the default DATA_DIR when none is set. Kept separate from `dataDir` so an
// external DATA_DIR (e.g. a mounted volume that starts empty, on a host like
// Railway) can be seeded from it on first run. See files.js `seedDataDirIfEmpty`.
const seedDir = path.resolve(here, '..', 'data');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : seedDir;

export const config = {
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  anthropicKey: required('ANTHROPIC_API_KEY'),
  model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  dataDir,
  seedDir,
  allowedChatId: process.env.ALLOWED_CHAT_ID
    ? String(process.env.ALLOWED_CHAT_ID).trim()
    : null,
  gitAutocommit: String(process.env.GIT_AUTOCOMMIT).toLowerCase() === 'true',
  dailyReminderTime: (process.env.DAILY_REMINDER_TIME || '').trim(),
};
