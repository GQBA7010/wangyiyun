import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Structured application logger. Emits newline-delimited JSON to stdout, which
 * is ideal for production log shippers and still readable in development.
 * Set LOG_LEVEL to override the default verbosity.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
})
