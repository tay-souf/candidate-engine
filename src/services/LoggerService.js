import pino from 'pino';

/**
 * Standard Logger Service
 * Uses pino for high performance structured logging
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' 
    ? {
        target: 'pino-pretty',
        options: { colorize: true }
      }
    : undefined
});

export default logger;
