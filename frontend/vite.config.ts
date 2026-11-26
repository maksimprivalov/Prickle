/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Keep in step with "paths" in tsconfig.json.
const folders = ['app', 'features', 'components', 'lib', 'styles', 'test'] as const;
const alias: Record<string, string> = Object.fromEntries(
  folders.map((f): [string, string] => [
    `@${f}`,
    fileURLToPath(new URL(`./src/${f}`, import.meta.url)),
  ]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
