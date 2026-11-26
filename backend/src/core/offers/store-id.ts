import { z } from 'zod';

export const StoreId = { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' } as const;
export type StoreId = (typeof StoreId)[keyof typeof StoreId];

export const StoreIdSchema = z.enum(StoreId);
