import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Keep in step with "paths" in tsconfig.json.
const folders = ['core', 'agents', 'tools', 'runtime', 'payments', 'app'] as const;
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const alias: Record<string, string> = {
  ...Object.fromEntries(folders.map((f): [string, string] => [`@${f}`, at(`./src/${f}`)])),
  '@test': at('./test'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
