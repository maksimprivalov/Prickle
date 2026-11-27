// Number grounding (fix 1): every number an agent writes must equal a value in a record the
// same output cites. Code, not a second LLM, so "was €649" against a record of €639 is caught.
//
// What counts:
//   - a date written as YYYY-MM-DD must equal a date string in a cited record;
//   - any other number must equal an integer in a cited record, either as written (55 inches,
//     30 days, "Only 2 left!") or as euros turned into cents (€599.00 is 59900);
//   - "599", "599.00", "€599", "599,00" and "1,299.00" / "1.299,00" are the same values; nothing
//     is ever rounded to make a match;
//   - digits inside record ids ("c-tv55-ph-1023") and words ("tv55") are not numbers.
// An output cites a record by containing its id anywhere (sources, matches, …).

export type GroundingRecord = { readonly recordId: string };

export type GroundingResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The numbers as the agent wrote them, e.g. ["€649.00", "2026-10-01"]. */
      readonly unsourced: readonly [string, ...string[]];
    };

const DATE = /(?<![\p{L}\p{N}_-])(\d{4}-\d{2}-\d{2})(?![\p{L}\p{N}_-])/gu;
/** Hyphenated words with a letter in them: record ids ("c-tv55-ph-1023"), "55-inch". */
const ID_LIKE = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu;
// Whole part (optionally with thousands groups), then an optional 1–2 digit fraction.
const NUMBER =
  /(?<![\p{L}\p{N}_.,])(\d{1,3}(?:([.,])\d{3})(?:\2\d{3})*|\d+)(?:([.,])(\d{1,2}))?(?![\p{L}\p{N}_]|[.,]\d)/gu;

const blank = (match: string) => ' '.repeat(match.length);

type Token =
  | { readonly kind: 'date'; readonly raw: string; readonly date: string }
  | {
      readonly kind: 'number';
      readonly raw: string;
      /** The number as written, when it is a whole number (599.00 counts). */
      readonly whole: number | undefined;
      /** The number read as euros, in cents. */
      readonly cents: number;
    };

function tokens(text: string): Token[] {
  const found: Token[] = [];
  const prose = text
    .replace(DATE, (match: string) => {
      found.push({ kind: 'date', raw: match, date: match });
      return blank(match);
    })
    .replace(ID_LIKE, (match: string) => (/\p{L}/u.test(match) ? blank(match) : match));
  for (const match of prose.matchAll(NUMBER)) {
    const [raw, wholePart = '', groupSep, , fraction] = match;
    const whole = Number(groupSep === undefined ? wholePart : wholePart.split(groupSep).join(''));
    const frac = fraction === undefined ? 0 : Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(whole)) continue;
    found.push({
      kind: 'number',
      raw: raw.trim(),
      whole: frac === 0 ? whole : undefined,
      cents: whole * 100 + frac,
    });
  }
  return found;
}

/** Every string and number inside a value, depth first. */
function* leaves(value: unknown): Generator<string | number> {
  if (typeof value === 'string' || typeof value === 'number') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* leaves(item);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) yield* leaves(item);
  }
}

export function checkGrounding(
  output: unknown,
  records: readonly GroundingRecord[],
  options: {
    /** Numbers the rules themselves use, e.g. 30 for the 30-day window. */
    readonly constants?: readonly number[];
  } = {},
): GroundingResult {
  const byId = new Map(records.map((r) => [r.recordId, r]));

  // The records this output cites, and every value in them.
  const cited = new Set<string>();
  for (const leaf of leaves(output)) {
    if (typeof leaf === 'string' && byId.has(leaf)) cited.add(leaf);
  }
  const integers = new Set<number>(options.constants ?? []);
  const dates = new Set<string>();
  for (const id of cited) {
    for (const leaf of leaves(byId.get(id))) {
      if (typeof leaf === 'number') {
        if (Number.isSafeInteger(leaf)) integers.add(leaf);
        continue;
      }
      if (byId.has(leaf)) continue;
      for (const token of tokens(leaf)) {
        if (token.kind === 'date') dates.add(token.date);
        else if (token.whole !== undefined) integers.add(token.whole);
      }
    }
  }

  // Every number the agent wrote in its own words. Record ids are not prose.
  const unsourced: string[] = [];
  for (const leaf of leaves(output)) {
    if (typeof leaf === 'number') {
      if (!integers.has(leaf)) unsourced.push(String(leaf));
      continue;
    }
    if (byId.has(leaf)) continue;
    for (const token of tokens(leaf)) {
      const sourced =
        token.kind === 'date'
          ? dates.has(token.date)
          : integers.has(token.cents) || (token.whole !== undefined && integers.has(token.whole));
      if (!sourced) unsourced.push(token.raw);
    }
  }

  const [first, ...rest] = unsourced;
  return first === undefined ? { ok: true } : { ok: false, unsourced: [first, ...rest] };
}
