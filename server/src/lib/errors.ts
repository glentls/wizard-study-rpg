/** Error body contract: {code, message, details, request_id} (spec §12 API standards). */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Not allowed') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, 'THROTTLED', 'Too many requests, slow down', { retry_after_seconds: retryAfterSeconds });
