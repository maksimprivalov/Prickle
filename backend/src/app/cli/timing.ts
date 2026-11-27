import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  concurrencyReport,
  parseRunLog,
  timelineLanes,
  timingTable,
} from '@app/report/concurrency';

// pnpm timing [runs/<session>.jsonl]: the concurrency proof (fix 5) from a run log. Prints the
// README table (wall-clock against summed time) and one lane per agent loop. With no argument it
// reads the newest log in runs/. Reads the log only: no model, no network.

function newestRunLog(dir: string): string | undefined {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  } catch {
    return undefined;
  }
}

const path = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? newestRunLog('runs');
if (!path) {
  console.error(
    'No run log: give a path, or run pnpm demo first (it writes runs/<session>.jsonl).',
  );
  process.exit(1);
}

const report = concurrencyReport(parseRunLog(readFileSync(path, 'utf8')));
if (report.spans.length === 0) {
  console.error(`${path} has no agent loops.`);
  process.exit(1);
}

console.log(`Run log: ${path}${report.sessionId ? ` (session ${report.sessionId})` : ''}\n`);
console.log(timingTable(report));
console.log('');
for (const lane of timelineLanes(report)) console.log(lane);
