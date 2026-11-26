import { z } from 'zod';
import { startMockStores } from './serve';

// Runs the mock stores on their own, to look at them with curl or a browser:
//   pnpm exec tsx src/mock-stores/main.ts        then open http://127.0.0.1:8790/stores/e/deals

const port = z.coerce.number().int().min(1).max(65535).default(8790).parse(process.env.STORES_PORT);
const stores = await startMockStores({ port });
console.log(`Mock stores A–E on ${stores.baseUrl}/stores/<a-e>/ (Ctrl+C to stop)`);
