import { readFileSync } from 'node:fs';

const promptsDir = new URL('../prompts/', import.meta.url);
const cache = new Map<string, string>();

/** Reads src/prompts/<file> once. Agent specs name the file; the adapter needs the text. */
export function loadPrompt(file: string): string {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(new URL(file, promptsDir), 'utf8');
  cache.set(file, text);
  return text;
}
