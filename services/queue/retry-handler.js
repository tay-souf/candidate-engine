// ============================================
// Retry Handler - Exponential Backoff
// ============================================

import { createLogger } from '../../src/lib/logger.js';
import { db } from '../../src/lib/database.js';

const logger = createLogger({ module: 'RetryHandler' });

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,       // 1 second
    maxDelay: 30000,           // 30 seconds
    backoffMultiplier: 2,
    jitterEnabled: true,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    nonRetryableStatusCodes: [400, 401, 403, 404, 422]
};

/**
 * Execute a function with retry logic
 * @param {Function} fn - Async function to retry
 * @param {Object} config - Retry configuration
 * @param {Object} context - Context for logging
 * @returns {Promise<any>}
 */
export async function withRetry(fn, config = {}, context = {}) {
    const retryConfig = { ...DEFAULT_CONFIG, ...config };
    let lastError = null;
    let attempt = 0;

    while (attempt <= retryConfig.maxRetries) {
        try {
            const result = await fn(attempt);
            
            if (attempt > 0) {
                logger.info({ 
                    ...context, 
                    attempt: attempt + 1 
                }, 'Retry succeeded');
            }
            
            return result;
        } catch (error) {
            lastError = error;
            attempt++;

            // Check if error is retryable
            const statusCode = error.response?.status || error.statusCode;
            
            if (retryConfig.nonRetryableStatusCodes.includes(statusCode)) {
                logger.error({ 
                    ...context, 
                    statusCode, 
                    error: error.message 
                }, 'Non-retryable error');
                throw error;
            }

            if (attempt > retryConfig.maxRetries) {
                logger.error({ 
                    ...context, 
                    attempts: attempt, 
                    error: error.message 
                }, 'All retries exhausted');
                break;
            }

            // Calculate delay with exponential backoff
            let delay = Math.min(
                retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
                retryConfig.maxDelay
            );

            // Add jitter to prevent thundering herd
            if (retryConfig.jitterEnabled) {
                delay = delay * (0.5 + Math.random() * 0.5);
            }

            // Handle rate limit headers
            if (statusCode === 429) {
                const retryAfter = error.response?.headers?.['retry-after'];
                if (retryAfter) {
                    delay = parseInt(retryAfter) * 1000;
                }
            }

            logger.warn({ 
                ...context, 
                attempt, 
                delay: `${Math.round(delay)}ms`, 
                error: error.message 
            }, 'Retrying after delay');

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
    constructor(maxRequests, windowSeconds) {
        this.maxRequests = maxRequests;
        this.windowSeconds = windowSeconds;
        this.requests = [];
    }

    /**
     * Wait until a request slot is available
     */
    async waitForSlot() {
        const now = Date.now();
        const windowStart = now - (this.windowSeconds * 1000);
        
        // Remove old requests outside the window
        this.requests = this.requests.filter(t => t > windowStart);
        
        if (this.requests.length >= this.maxRequests) {
            // Calculate wait time
            const oldestInWindow = this.requests[0];
            const waitTime = (oldestInWindow + this.windowSeconds * 1000) - now;
            
            if (waitTime > 0) {
                logger.debug({ 
                    waitMs: waitTime, 
                    queueSize: this.requests.length 
                }, 'Rate limit: waiting for slot');
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            
            // Recursive check
            return this.waitForSlot();
        }
        
        this.requests.push(now);
    }

    /**
     * Execute function with rate limiting
     * @param {Function} fn 
     * @returns {Promise<any>}
     */
    async execute(fn) {
        await this.waitForSlot();
        return fn();
    }
}

/**
 * Database-backed rate limiter for distributed environments
 */
export class DistributedRateLimiter {
    /**
     * Check and increment rate limit counter
     * @param {string} clientId 
     * @param {string} apiName 
     * @param {string} endpoint 
     * @param {number} maxRequests 
     * @param {number} windowSeconds 
     * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number}>}
     */
    static async checkLimit(clientId, apiName, endpoint = 'default', maxRequests = 100, windowSeconds = 60) {
        const result = await db.query(`
            INSERT INTO api_rate_limits (id, client_id, api_name, endpoint, max_requests, window_seconds, current_count, window_start)
            VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 1, NOW())
            ON CONFLICT (client_id, api_name, endpoint)
            DO UPDATE SET
                current_count = CASE 
                    WHEN api_rate_limits.window_start + make_interval(secs => api_rate_limits.window_seconds) < NOW()
                    THEN 1
                    ELSE api_rate_limits.current_count + 1
                END,
                window_start = CASE
                    WHEN api_rate_limits.window_start + make_interval(secs => api_rate_limits.window_seconds) < NOW()
                    THEN NOW()
                    ELSE api_rate_limits.window_start
                END,
                last_request_at = NOW(),
                updated_at = NOW()
            RETURNING current_count, max_requests, window_start, window_seconds
        `, [clientId, apiName, endpoint, maxRequests, windowSeconds]);

        const row = result.rows[0];
        const allowed = row.current_count <= row.max_requests;
        const remaining = Math.max(0, row.max_requests - row.current_count);
        const windowEnd = new Date(row.window_start).getTime() + (row.window_seconds * 1000);
        const retryAfter = allowed ? 0 : Math.ceil((windowEnd - Date.now()) / 1000);

        return { allowed, remaining, retryAfter };
    }
}
