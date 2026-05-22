import { normalizeBrand, getCfgSchema } from '@/lib/brand-server';
import { ensureBrandCategoryTables } from '../category-dictionary/_ddl';

export async function resolveBrandCfgSchema(brandParam: unknown) {
  const brand = normalizeBrand(String(brandParam || '').trim());
  if (!brand) {
    throw Object.assign(new Error('Invalid brand'), { status: 400 });
  }
  const cfgSchema = getCfgSchema(brand);
  await ensureBrandCategoryTables(cfgSchema);
  return { brand, cfgSchema };
}

export function normCode(code: unknown, field: string) {
  const c = String(code || '').trim();
  if (!/^[A-Z0-9_]{2,32}$/.test(c)) {
    throw Object.assign(new Error(`Invalid ${field} (use A-Z0-9_)`), { status: 400 });
  }
  return c;
}

export function normDirection(v: unknown) {
  const s = String(v || 'any').trim();
  if (!['in', 'out', 'any'].includes(s)) {
    throw Object.assign(new Error('Invalid direction (in|out|any)'), { status: 400 });
  }
  return s;
}
