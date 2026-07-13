function parsePeriod(period: string, span: string): [string, string] | null {
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

export function buildPeriodBoundaries(period: string, span: string): { start: string; end: string } | null {
  const result = parsePeriod(period, span);
  return result ? { start: result[0], end: result[1] } : null;
}

export function buildStoreCondition(store: string, paramOffset: number = 2): { clause: string; params: unknown[] } {
  if (store === 'all') return { clause: '', params: [] };
  return {
    clause: `AND store_code = $${paramOffset}`,
    params: [store],
  };
}

export function getPrevBoundaries(period: string, span: string): [string, string] | null {
  if (span === 'month') {
    const [y, m] = period.split('-');
    let pm = Number(m) - 1, py = Number(y);
    if (pm < 1) { pm = 12; py--; }
    const pp = `${py}-${String(pm).padStart(2, '0')}`;
    return parsePeriod(pp, 'month');
  }
  if (span === 'quarter') {
    const [y, q] = period.split('-Q');
    if (q === '1') return parsePeriod(`${Number(y) - 1}-Q4`, 'quarter');
    return parsePeriod(`${y}-Q${Number(q) - 1}`, 'quarter');
  }
  if (span === 'year') {
    return parsePeriod(String(Number(period) - 1), 'year');
  }
  return null;
}
