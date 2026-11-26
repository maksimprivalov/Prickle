import { z } from 'zod';
import { Cents, UsdcUnits } from '../money/money';
import { RecordId } from './record-id';

// Money never travels alone: the amount and the record it was read from go together, so the
// terminal, the frontend and the grounding check can always show where a number came from.

export const SourcedCents = z.object({ amount: Cents, recordId: RecordId });
export type SourcedCents = z.infer<typeof SourcedCents>;

export const SourcedUsdc = z.object({ amount: UsdcUnits, recordId: RecordId });
export type SourcedUsdc = z.infer<typeof SourcedUsdc>;
