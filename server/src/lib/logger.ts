/** Structured JSON logs. Never pass passwords, tokens or study notes here (NFR-008). */
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: Level, msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(enabled = true): Logger {
  const log = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (!enabled) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    log,
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
  };
}
