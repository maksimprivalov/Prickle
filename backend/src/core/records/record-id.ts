import { z } from 'zod';

/**
 * A stable id for every record a tool returns: `<store>-<offer>-<kind>-<n>`, e.g.
 * `c-tv55-ph-1003`. Every number an agent or event reports points at one of these.
 */
export const RecordId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens only');
export type RecordId = z.infer<typeof RecordId>;

/** The mandate is a record too: the user's own numbers cite it. */
export const MANDATE_RECORD_ID = 'mandate' satisfies RecordId;
