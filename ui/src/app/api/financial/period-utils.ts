// Shared utilities for financial statement API routes

export function parsePeriod(period: string, span: string): [string, string] | null {
  if (span === 'month') {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) return null;
    const [y, m] = period.split('-');
    const nextM = Number(m) + 1;
    return [
      `${period}-01`,
      nextM > 12 ? `${Number(y) + 1}-01-01` : `${y}-${String(nextM).padStart(2, '0')}-01`
    ];
  }
  if (span === 'quarter') {
    if (!/^\d{4}-Q[1-4]$/.test(period)) return null;
    const [year, q] = period.split('-Q');
    const startM = (Number(q) - 1) * 3 + 1;
    const endM = startM + 3;
    if (endM > 12) {
      return [
        `${year}-${String(startM).padStart(2, '0')}-01`,
        `${Number(year) + 1}-01-01`
      ];
    }
    return [
      `${year}-${String(startM).padStart(2, '0')}-01`,
      `${year}-${String(endM).padStart(2, '0')}-01`
    ];
  }
  if (span === 'year') {
    if (!/^\d{4}$/.test(period)) return null;
    return [`${period}-01-01`, `${Number(period) + 1}-01-01`];
  }
  return null;
}
