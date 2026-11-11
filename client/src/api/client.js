/** An error response in the standard shape `{ error: { code, message, requestId, ... } }` (spec 6.1). */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status; 0 when the request never reached the server.
   * @param {{ code?: string, message?: string, requestId?: string }} [error]
   */
  constructor(status, error = {}) {
    super(error.message ?? 'Something went wrong. Try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code ?? 'INTERNAL';
    this.requestId = error.requestId;
    this.details = error;
  }
}

/**
 * Calls the API on this origin. Every client request goes through this function.
 * @param {string} path Path below `/api`, for example `/me`.
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>} The parsed JSON body, or `null` for an empty response.
 * @throws {ApiError}
 */
export async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error);
  return data;
}
