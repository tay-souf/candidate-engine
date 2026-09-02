import Redis from 'ioredis';
import logger from './LoggerService.js';

/**
 * Deduplication Service
 * Prevents double-contacting candidates by keeping track of outreach actions in Redis
 */
export default class DedupService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  /**
   * Checks if an action was already performed for a candidate
   * @param {string} candidateId - The ID of the candidate
   * @param {string} action - The action (e.g., 'sms_initial', 'call_followup')
   * @returns {Promise<boolean>} True if action was already taken
   */
  async hasActionBeenTaken(candidateId, action) {
    const key = `dedup:${candidateId}:${action}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Marks an action as taken to prevent duplicates
   * @param {string} candidateId - The ID of the candidate
   * @param {string} action - The action taken
   * @param {number} ttlSeconds - Time to live in seconds (default: 30 days)
   */
  async markActionTaken(candidateId, action, ttlSeconds = 30 * 24 * 60 * 60) {
    const key = `dedup:${candidateId}:${action}`;
    await this.redis.set(key, '1', 'EX', ttlSeconds);
    logger.debug(`Marked action ${action} for candidate ${candidateId} to prevent duplicates`);
  }
}
