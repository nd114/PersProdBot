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

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.cwd(), process.env.DATA_DIR)
  : path.resolve(here, '..', 'data');

export const config = {
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  anthropicKey: required('ANTHROPIC_API_KEY'),
  model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  dataDir,
  allowedChatId: process.env.ALLOWED_CHAT_ID
    ? String(process.env.ALLOWED_CHAT_ID).trim()
    : null,
  gitAutocommit: String(process.env.GIT_AUTOCOMMIT).toLowerCase() === 'true',
  dailyReminderTime: (process.env.DAILY_REMINDER_TIME || '').trim(),
};
