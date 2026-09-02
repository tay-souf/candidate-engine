// ============================================
// Logger - Pino with structured logging
// ============================================

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    transport: isProduction ? undefined : {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        }
    },
    base: {
        service: 'stratton-candidate-engine',
        env: process.env.NODE_ENV || 'development'
    },
    serializers: {
        error: pino.stdSerializers.err
    }
});

/**
 * Create a child logger with context
 * @param {Object} context - Additional context fields
 * @returns {pino.Logger}
 */
export function createLogger(context) {
    return logger.child(context);
}
