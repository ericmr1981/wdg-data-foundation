export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(`API error ${status}: ${detail}`);
    this.status = status;
    this.name = 'ApiError';
  }
}

/**
 * Throw ApiError on non-ok HTTP responses. Returns void on success.
 */
export async function assertApiOk(res: Response, operation: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, `${operation} failed (HTTP ${res.status}): ${body}`);
  }
}

/**
 * Ensure res.ok AND json.success is truthy (when present).
 * Returns the parsed JSON body. Lenient — if there's no `success` field,
 * just check that res.ok passed.
 */
export async function assertApiSuccess<T = unknown>(
  res: Response,
  operation: string,
): Promise<T> {
  await assertApiOk(res, operation);
  const json = await res.json().catch(() => null);
  if (json && typeof json === 'object' && 'success' in json && !json.success) {
    throw new ApiError(res.status, `${operation}: ${json.error ?? 'unknown error'}`);
  }
  return json as T;
}
