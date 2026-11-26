import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-data/generate';

// `pnpm gen:data`: writes the seeded synthetic dataset to data/fixtures/. Never edit the
// fixtures by hand; change ./gen-data/generate.ts and run this again.

const outDir = fileURLToPath(new URL('../data/fixtures/', import.meta.url));
const dataset = generate();

const files: Record<string, unknown> = {
  'dataset.json': dataset.meta,
  'demo-mandate.json': dataset.demoMandate,
  'stores.json': dataset.stores,
  'offers.json': dataset.offers,
  'price-history.json': dataset.priceHistory,
  'checkouts.json': dataset.checkouts,
  'traps.json': dataset.traps,
};

await mkdir(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  await writeFile(join(outDir, name), `${JSON.stringify(content, null, 2)}\n`);
}

const { counts } = dataset.meta;
console.log(
  `Wrote data/fixtures (seed ${dataset.meta.seed}): ${counts.stores} stores, ${counts.offers} offers, ` +
    `${counts.priceHistoryRows} price-history rows, ${counts.traps} traps.`,
);
