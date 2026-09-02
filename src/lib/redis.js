// ============================================
// Redis Connection - Cache & Queue Backend
// ============================================

import Redis from 'ioredis';
import { logger } from './logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        logger.warn({ attempt: times, delay }, 'Redis reconnecting...');
        return delay;
    },
    lazyConnect: false,
});

redis.on('connect', () => {
    logger.info('✅ Redis connected');
});

redis.on('error', (err) => {
    logger.error({ error: err.message }, 'Redis connection error');
});

redis.on('close', () => {
    logger.warn('Redis connection closed');
});

/**
 * Cache helper with automatic JSON serialization
 */
export const cache = {
    /**
     * Get cached value
     * @param {string} key 
     * @returns {Promise<any>}
     */
    async get(key) {
        const value = await redis.get(key);
        if (!value) return null;
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    },

    /**
     * Set cached value with optional TTL
     * @param {string} key 
     * @param {any} value 
     * @param {number} ttlSeconds 
     */
    async set(key, value, ttlSeconds = 3600) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttlSeconds) {
            await redis.setex(key, ttlSeconds, serialized);
        } else {
            await redis.set(key, serialized);
        }
    },

    /**
     * Delete cached value
     * @param {string} key 
     */
    async del(key) {
        await redis.del(key);
    },

    /**
     * Check if key exists
     * @param {string} key 
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        return (await redis.exists(key)) === 1;
    },

    /**
     * Increment counter
     * @param {string} key 
     * @param {number} ttlSeconds 
     * @returns {Promise<number>}
     */
    async increment(key, ttlSeconds = 3600) {
        const result = await redis.incr(key);
        if (result === 1 && ttlSeconds) {
            await redis.expire(key, ttlSeconds);
        }
        return result;
    }
};
