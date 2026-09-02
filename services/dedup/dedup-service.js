// ============================================
// Deduplication Service
// Prevents duplicate contact attempts
// ============================================

import { createLogger } from '../../src/lib/logger.js';
import { db } from '../../src/lib/database.js';
import { cache } from '../../src/lib/redis.js';
import crypto from 'crypto';

const logger = createLogger({ module: 'DedupService' });

export class DedupService {

    /**
     * Generate idempotency key for a contact attempt
     * @param {string} campaignId 
     * @param {string} candidateId 
     * @param {string} channel - 'sms' | 'voice' | 'email'
     * @param {number} sequenceStep 
     * @returns {string}
     */
    static generateIdempotencyKey(campaignId, candidateId, channel, sequenceStep) {
        return crypto.createHash('sha256')
            .update(`${campaignId}:${candidateId}:${channel}:${sequenceStep}`)
            .digest('hex');
    }

    /**
     * Check if a contact attempt is a duplicate
     * Uses both Redis (fast) and PostgreSQL (authoritative)
     * @param {string} idempotencyKey 
     * @returns {Promise<boolean>} true if duplicate
     */
    static async isDuplicate(idempotencyKey) {
        // Fast check with Redis
        const cachedResult = await cache.exists(`dedup:${idempotencyKey}`);
        if (cachedResult) {
            logger.debug({ key: idempotencyKey }, 'Duplicate detected (cache)');
            return true;
        }

        // Authoritative check with DB
        const dbResult = await db.query(
            `SELECT id FROM contact_attempts WHERE idempotency_key = $1 LIMIT 1`,
            [idempotencyKey]
        );

        if (dbResult.rows.length > 0) {
            // Populate cache for future fast checks
            await cache.set(`dedup:${idempotencyKey}`, '1', 86400); // 24h TTL
            logger.debug({ key: idempotencyKey }, 'Duplicate detected (database)');
            return true;
        }

        return false;
    }

    /**
     * Reserve an idempotency key (atomic lock)
     * @param {string} idempotencyKey 
     * @param {number} ttlSeconds - Lock TTL
     * @returns {Promise<boolean>} true if reserved successfully
     */
    static async reserveKey(idempotencyKey, ttlSeconds = 3600) {
        const { redis } = await import('../../src/lib/redis.js');
        
        // Use Redis SET NX (set if not exists) for atomic reservation
        const result = await redis.set(
            `dedup:${idempotencyKey}`, 
            Date.now().toString(), 
            'EX', ttlSeconds, 
            'NX'
        );

        if (result === 'OK') {
            logger.debug({ key: idempotencyKey }, 'Idempotency key reserved');
            return true;
        }

        logger.debug({ key: idempotencyKey }, 'Idempotency key already reserved');
        return false;
    }

    /**
     * Check if a candidate can be contacted
     * Comprehensive check: opt-out + cooldown + duplicate + daily limits
     * @param {Object} params 
     * @returns {Promise<{canContact: boolean, reason: string}>}
     */
    static async canContactCandidate(params) {
        const { 
            candidateId, 
            campaignId, 
            clientId,
            channel, 
            sequenceStep = 0,
            cooldownHours = 24 
        } = params;

        // 1. Check opt-out
        const optOutResult = await db.query(
            `SELECT is_opted_out($1, $2) as opted_out`,
            [candidateId, channel]
        );
        if (optOutResult.rows[0]?.opted_out) {
            return { canContact: false, reason: 'opted_out' };
        }

        // 2. Check candidate status
        const candidateResult = await db.query(
            `SELECT status FROM candidates WHERE id = $1`,
            [candidateId]
        );
        const blockedStatuses = ['opted_out', 'do_not_contact', 'placed'];
        if (blockedStatuses.includes(candidateResult.rows[0]?.status)) {
            return { canContact: false, reason: `status_${candidateResult.rows[0].status}` };
        }

        // 3. Check cooldown
        const cooldownResult = await db.query(
            `SELECT check_duplicate_contact($1, $2, $3, $4) as can_contact`,
            [candidateId, campaignId, channel, cooldownHours]
        );
        if (!cooldownResult.rows[0]?.can_contact) {
            return { canContact: false, reason: 'cooldown_active' };
        }

        // 4. Check idempotency key
        const idempotencyKey = this.generateIdempotencyKey(
            campaignId, candidateId, channel, sequenceStep
        );
        if (await this.isDuplicate(idempotencyKey)) {
            return { canContact: false, reason: 'duplicate_attempt' };
        }

        // 5. Check daily client limits
        const dailyLimitResult = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE channel = 'voice') as daily_calls,
                COUNT(*) FILTER (WHERE channel = 'sms') as daily_sms
            FROM contact_attempts 
            WHERE client_id = $1 
              AND direction = 'outbound'
              AND attempted_at >= CURRENT_DATE
        `, [clientId]);

        const clientResult = await db.query(
            `SELECT max_daily_calls, max_daily_sms FROM clients WHERE id = $1`,
            [clientId]
        );

        const dailyCounts = dailyLimitResult.rows[0];
        const limits = clientResult.rows[0];

        if (channel === 'voice' && parseInt(dailyCounts.daily_calls) >= limits?.max_daily_calls) {
            return { canContact: false, reason: 'daily_call_limit_reached' };
        }
        if (channel === 'sms' && parseInt(dailyCounts.daily_sms) >= limits?.max_daily_sms) {
            return { canContact: false, reason: 'daily_sms_limit_reached' };
        }

        // 6. Check business hours
        const clientTimezone = (await db.query(
            `SELECT timezone, outreach_hours_start, outreach_hours_end, outreach_days FROM clients WHERE id = $1`,
            [clientId]
        )).rows[0];

        if (clientTimezone) {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: clientTimezone.timezone,
                hour: 'numeric',
                hour12: false
            });
            const currentHour = parseInt(formatter.format(now));
            const startHour = parseInt(clientTimezone.outreach_hours_start?.split(':')[0] || '9');
            const endHour = parseInt(clientTimezone.outreach_hours_end?.split(':')[0] || '18');
            const currentDay = new Date().getDay();

            if (currentHour < startHour || currentHour >= endHour) {
                return { canContact: false, reason: 'outside_business_hours' };
            }
            if (!clientTimezone.outreach_days?.includes(currentDay)) {
                return { canContact: false, reason: 'non_business_day' };
            }
        }

        return { canContact: true, reason: 'ok' };
    }

    /**
     * Deduplicate candidate records (merge duplicates)
     * @param {string} clientId 
     * @param {string} phone 
     * @returns {Promise<Object>} Primary candidate record
     */
    static async deduplicateByPhone(clientId, phone) {
        const normalizedPhone = phone.replace(/[^0-9+]/g, '');
        
        const duplicates = await db.query(`
            SELECT id, first_name, last_name, email, phone_normalized, created_at
            FROM candidates 
            WHERE client_id = $1 AND phone_normalized = $2
            ORDER BY created_at ASC
        `, [clientId, normalizedPhone]);

        if (duplicates.rows.length <= 1) {
            return duplicates.rows[0] || null;
        }

        // Keep the oldest record as primary
        const primary = duplicates.rows[0];
        const duplicateIds = duplicates.rows.slice(1).map(r => r.id);

        logger.info({ 
            primaryId: primary.id, 
            duplicateCount: duplicateIds.length 
        }, 'Merging duplicate candidates');

        // Move all contact attempts to primary
        await db.query(`
            UPDATE contact_attempts SET candidate_id = $1 
            WHERE candidate_id = ANY($2)
        `, [primary.id, duplicateIds]);

        // Move qualifications
        await db.query(`
            UPDATE qualifications SET candidate_id = $1 
            WHERE candidate_id = ANY($2)
        `, [primary.id, duplicateIds]);

        // Move appointments
        await db.query(`
            UPDATE appointments SET candidate_id = $1 
            WHERE candidate_id = ANY($2)
        `, [primary.id, duplicateIds]);

        // Delete duplicates
        await db.query(
            `DELETE FROM candidates WHERE id = ANY($1)`,
            [duplicateIds]
        );

        return primary;
    }
}
