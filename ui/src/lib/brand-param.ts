import { z } from 'zod';

/**
 * All valid brand codes — central source of truth.
 * yufeng is DEPRECATED and intentionally absent.
 * To add a new brand: add it to this array + update describe() strings in tools.
 */
export const BRAND_NAMES = ['gelatomiiix', 'bonjur', 'tamkoko'] as const;

/**
 * Zod schema for brand parameter. Accepts gelatomiiix | bonjur | tamkoko only.
 * Use as:  brand: brandParamSchema.optional().default('gelatomiiix')
 */
export const brandParamSchema = z
  .enum(BRAND_NAMES as unknown as [string, ...string[]])
  .describe('Brand code: gelatomiiix | bonjur | tamkoko');
