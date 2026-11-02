import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface EnvConfig {
  port: number;
  dbPath: string;
  appVersion: string;
  isProduction: boolean;
  /** HMAC key for analytics pseudonyms. Must be set (and kept stable) in production. */
  pseudonymSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  /** Built client served by the API in production (single deployable). */
  clientDistDir: string;
  /** No email provider in MVP: in development, reset/verify links are written to the log. */
  logEmailLinks: boolean;
  workerIntervalSeconds: number;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const isProduction = env.NODE_ENV === 'production';
  const pseudonymSecret = env.PSEUDONYM_SECRET ?? (isProduction ? '' : randomBytes(16).toString('hex'));
  if (isProduction && !pseudonymSecret) throw new Error('PSEUDONYM_SECRET is required in production');
  return {
    port: Number(env.PORT ?? 3001),
    dbPath: env.DB_PATH ?? resolve(process.cwd(), 'data', 'wizard-study.db'),
    appVersion: env.APP_VERSION ?? '0.1.0',
    isProduction,
    pseudonymSecret,
    accessTokenTtlSeconds: Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60),
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    clientDistDir: env.CLIENT_DIST_DIR ?? resolve(process.cwd(), '..', 'client', 'dist'),
    logEmailLinks: !isProduction,
    workerIntervalSeconds: Number(env.WORKER_INTERVAL_SECONDS ?? 15),
  };
}
