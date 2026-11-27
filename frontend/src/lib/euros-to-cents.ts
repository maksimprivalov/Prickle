// The mandate form takes euros as typed; the contract wants integer cents. String in, integer
// out, without ever parsing a float: "599,5" → 59950.

const EUROS = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

export function eurosToCents(input: string): number | undefined {
  const match = EUROS.exec(input.trim());
  if (!match) return undefined;
  const [, whole = '0', fraction = ''] = match;
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
}
