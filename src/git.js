import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const run = promisify(execFile);

/**
 * Commit and push the data directory. Best-effort: failures are logged but never
 * crash the bot. Enabled only when GIT_AUTOCOMMIT=true and the data dir is in a
 * git repo with push access configured.
 */
export async function autoCommit(message) {
  if (!config.gitAutocommit) return;
  const opts = { cwd: config.dataDir };
  try {
    await run('git', ['add', '-A', '.'], opts);
    // Nothing staged -> `git commit` exits non-zero; check first.
    const { stdout } = await run('git', ['status', '--porcelain'], opts);
    if (!stdout.trim()) return;
    await run('git', ['commit', '-m', message], opts);
    await run('git', ['push'], opts);
  } catch (err) {
    console.error('[git] auto-commit failed:', err.stderr || err.message);
  }
}
