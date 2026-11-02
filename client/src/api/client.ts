/**
 * Thin fetch wrapper. The access token lives only in memory; the refresh token is
 * an httpOnly cookie the browser sends to /v1/auth/refresh. A 401 triggers one
 * silent refresh and a single retry.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const setSignedOutHandler = (handler: () => void) => {
  onSignedOut = handler;
};

async function tryRefresh(): Promise<'ok' | 'no_session' | 'failed'> {
  const res = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
  if (res.ok) {
    setAccessToken(((await res.json()) as { access_token: string }).access_token);
    return 'ok';
  }
  const code = (await res.json().catch(() => null))?.code;
  return code === 'REFRESH_TOKEN_MISSING' ? 'no_session' : 'failed';
}

export function refreshSession(): Promise<boolean> {
  // A failed refresh gets one retry: another tab may have rotated the cookie a moment earlier.
  refreshInFlight ??= tryRefresh()
    .then(async (result) => {
      if (result !== 'failed') return result === 'ok';
      await new Promise((resolve) => setTimeout(resolve, 400));
      return (await tryRefresh()) === 'ok';
    })
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

interface RequestOptions {
  idempotencyKey?: string;
  retryOnAuth?: boolean;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 401 && opts.retryOnAuth !== false && !path.startsWith('/v1/auth/')) {
    if (await refreshSession()) return request<T>(method, path, body, { ...opts, retryOnAuth: false });
    setAccessToken(null);
    onSignedOut?.();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? `Request failed (${res.status})`, data?.details ?? null, data?.request_id ?? null);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body: unknown) => request<T>('DELETE', path, body),
};

/** Reward/currency mutations need a key; reuse the same key when retrying the same intent. */
export const newIdempotencyKey = () => crypto.randomUUID();

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
