export type BrandOption = { brand_code: string; brand_name: string };

export async function fetchBrands(): Promise<BrandOption[]> {
  const res = await fetch('/api/brands');
  const data = await res.json();
  if (!data?.success) return [];
  return data.data || [];
}
