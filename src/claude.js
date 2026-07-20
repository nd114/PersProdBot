import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { readFileOr } from './files.js';

// A short timeout so a blocked/dropped connection (e.g. a corporate firewall or
// proxy that silently swallows the request) surfaces as a clear error within
// seconds instead of hanging silently for the SDK's default ~10 minutes.
const client = new Anthropic({ apiKey: config.anthropicKey, timeout: 30_000 });

// Guardrail carried verbatim from the project's CLAUDE.md.
const NEVER_INVENT =
  'Never invent numbers that are not explicitly stated by the user. If a field ' +
  'is mentioned but its number is missing (e.g. "did prayer this morning" with no ' +
  'minutes), leave that field null and put a short question in clarification_needed.';

// Keys that represent actual log updates (everything except the meta fields).
// Note: day_type is deliberately excluded -- it's derived from the date (see
// dates.js `dayType()`), not parsed from the message. block3 (the rare 5-hour-day
// third work block) is excluded too, to stay under the API's cap on schema fields
// (see PARSE_SCHEMA below); edit that line manually on the rare day it applies.
export const UPDATE_KEYS = [
  'prayer_minutes', 'bible_chapters', 'bible_reached', 'bible_books_finished',
  'exercise_type', 'exercise_duration', 'exercise_rest', 'donothing', 'sleep_hours',
  'sleep_quality', 'weight_kg', 'eating', 'block1_target', 'block1_status', 'block2_target',
  'block2_status', 'orgA_progress', 'orgB_progress', 'socialization', 'learning',
  'went_well', 'slipped',
];

// Fields are intentionally optional rather than nullable unions: Claude's structured
// outputs caps schemas at 16 nullable/union-typed parameters, and separately at 24
// total optional parameters. An omitted field means "nothing to log here" -- same as
// null would -- and every call site already treats undefined and null identically
// (see files.js `has()`, claude.js `hasUpdates()`).
const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prayer_minutes: { type: 'number' },
    bible_chapters: { type: 'number' },
    bible_reached: { type: 'string' },
    bible_books_finished: { type: 'array', items: { type: 'string' } },
    exercise_type: { type: 'string' },
    exercise_duration: { type: 'string' },
    exercise_rest: { type: 'boolean' },
    donothing: { type: 'boolean' },
    sleep_hours: { type: 'number' },
    sleep_quality: { type: 'number' },
    weight_kg: { type: 'number' },
    eating: { type: 'string' },
    block1_target: { type: 'string' },
    block1_status: { type: 'string' },
    block2_target: { type: 'string' },
    block2_status: { type: 'string' },
    orgA_progress: { type: 'string' },
    orgB_progress: { type: 'string' },
    socialization: { type: 'string' },
    learning: { type: 'string' },
    went_well: { type: 'string' },
    slipped: { type: 'string' },
    clarification_needed: { type: 'string' },
    confirmation: { type: 'string' },
  },
};

function textOf(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Parse a free-text log message into structured fields.
 * Returns the parsed object (all keys present, non-updated ones null).
 */
export async function parseMessage(message, dateStr) {
  const template = readFileOr('daily-log-template.md');
  const goals = readFileOr('goals.md');

  const system =
    `You extract structured log data from short personal-tracking messages for a ` +
    `90-day productivity sprint, then hand them to a program that writes them into ` +
    `markdown files.\n\nToday's date is ${dateStr}.\n\n` +
    `The daily log has these fields:\n${template}\n\n` +
    `The measured goals are:\n${goals}\n\n` +
    `Rules:\n- ${NEVER_INVENT}\n` +
    `- prayer_minutes and bible_chapters are the amounts for THIS message only; the ` +
    `program accumulates them across the day. Convert hours to minutes (e.g. "45 min" ` +
    `-> 45, "2 hours" -> 120).\n` +
    `- exercise_rest = true only if the user says they rested / took the day off / it's ` +
    `Sabbath. If they skipped exercise but it was not a rest day, put that in "slipped".\n` +
    `- bible_reached is the book/chapter they got to (e.g. "Exodus 12"). ` +
    `bible_books_finished lists only books they clearly say they finished.\n` +
    `- weight_kg only when they report a weigh-in.\n` +
    `- socialization: a short phrase of who/what, or "Y" if they only say they socialized.\n` +
    `- confirmation: a single friendly line summarizing exactly what will be logged ` +
    `(e.g. "45 min prayer, 14 Bible chapters"), or null if nothing concrete was logged.\n` +
    `- Set clarification_needed only when the message clearly refers to a field but is ` +
    `missing the number that field needs. Otherwise leave it null.`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1024,
    system,
    output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
    messages: [{ role: 'user', content: message }],
  });

  return JSON.parse(textOf(response));
}

/** True if the parsed object contains at least one concrete update. */
export function hasUpdates(parsed) {
  return UPDATE_KEYS.some((k) => {
    const v = parsed[k];
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}

/**
 * Fill a review template from the daily logs. `kind` is "weekly" or "monthly".
 * `stats` are the pre-computed hard numbers (so the model never has to invent them).
 */
export async function generateReview({ kind, template, dailies, stats, goals, bible, weight }) {
  const logsBlock = dailies
    .map((d) => `----- ${d.date} -----\n${d.content}`)
    .join('\n\n');

  const system =
    `You are a calm, organized assistant helping run a ${kind} review for a 90-day ` +
    `productivity sprint. Advisory tone, not authoritative: surface the data and trends ` +
    `clearly, flag plainly anything that has been slipping 3+ days running, and never ` +
    `invent numbers that are not in the logs. Fill in the review template below using the ` +
    `provided daily logs and pre-computed stats. Leave the personal reflection questions ` +
    `for the user to answer (keep them in the output as prompts). Return ONLY the filled ` +
    `markdown, no preamble.`;

  const user =
    `Pre-computed stats (authoritative -- use these, do not recompute differently):\n` +
    `${JSON.stringify(stats, null, 2)}\n\n` +
    `Bible progress: ${bible.completed}/1189 (${bible.pct}%)\n` +
    `Latest recorded weight: ${weight ?? 'not recorded'} kg (target 75kg)\n\n` +
    `Goals for reference:\n${goals}\n\n` +
    `Daily logs:\n${logsBlock}\n\n` +
    `Review template to fill:\n${template}`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: user }],
  });

  return textOf(response).trim();
}
