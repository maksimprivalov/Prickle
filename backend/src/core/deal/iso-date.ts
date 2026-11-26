// Calendar dates as YYYY-MM-DD strings, in UTC so the day never shifts with a time zone.

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00.000Z`) : NaN;
  // The round trip also refuses dates that do not exist, like 2026-02-30.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`not a calendar date: ${date}`);
  }
  return ms;
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The `count` days just before `date`, oldest first: daysBefore('2026-11-20', 2) is 18th, 19th. */
export function daysBefore(date: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(date, i - count));
}
