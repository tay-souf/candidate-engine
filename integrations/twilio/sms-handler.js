// ============================================
// Twilio SMS Handler
// Send/Receive SMS for candidate outreach
// ============================================

import twilio from 'twilio';
import { createLogger } from '../../src/lib/logger.js';
import { db } from '../../src/lib/database.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger({ module: 'TwilioSMS' });

// Initialize Twilio client
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

/**
 * Twilio SMS Handler
 * Manages SMS outreach and responses
 */
export class TwilioSMSHandler {

    /**
     * Send an SMS to a candidate
     * @param {Object} params - SMS parameters
     * @returns {Promise<Object>}
     */
    static async sendSMS(params) {
        const {
            candidateId,
            campaignId,
            clientId,
            phoneNumber,
            message,
            sequenceStep = 0,
            metadata = {}
        } = params;

        const idempotencyKey = `sms:${campaignId}:${candidateId}:${sequenceStep}:${Date.now()}`;

        try {
            // Check opt-out
            const optOutCheck = await db.query(
                `SELECT is_opted_out($1, 'sms') as opted_out`,
                [candidateId]
            );
            
            if (optOutCheck.rows[0]?.opted_out) {
                logger.warn({ candidateId }, 'Candidate opted out of SMS');
                return { status: 'skipped', reason: 'opted_out' };
            }

            // Check duplicate
            const dupCheck = await db.query(
                `SELECT check_duplicate_contact($1, $2, 'sms', 4) as can_contact`,
                [candidateId, campaignId]
            );
            
            if (!dupCheck.rows[0]?.can_contact) {
                logger.warn({ candidateId }, 'SMS duplicate contact prevented');
                return { status: 'skipped', reason: 'duplicate' };
            }

            // Send via Twilio
            const twilioMessage = await twilioClient.messages.create({
                body: message,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phoneNumber,
                statusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/twilio/sms-status`
            });

            // Record contact attempt
            await db.query(`
                INSERT INTO contact_attempts (
                    id, client_id, candidate_id, campaign_id,
                    channel, direction, sequence_step, idempotency_key,
                    phone_used, sms_sid, sms_body, status, attempted_at
                ) VALUES ($1, $2, $3, $4, 'sms', 'outbound', $5, $6, $7, $8, $9, 'sent', NOW())
            `, [
                uuidv4(), clientId, candidateId, campaignId,
                sequenceStep, idempotencyKey,
                phoneNumber, twilioMessage.sid, message
            ]);

            logger.info({ 
                sid: twilioMessage.sid, 
                candidateId,
                phone: phoneNumber.slice(-4) 
            }, 'SMS sent successfully');

            return {
                status: 'sent',
                sms_sid: twilioMessage.sid,
                idempotency_key: idempotencyKey
            };
        } catch (error) {
            // Record failed attempt
            await db.query(`
                INSERT INTO contact_attempts (
                    id, client_id, candidate_id, campaign_id,
                    channel, direction, sequence_step, idempotency_key,
                    phone_used, sms_body, status, error_code, error_message, attempted_at
                ) VALUES ($1, $2, $3, $4, 'sms', 'outbound', $5, $6, $7, $8, 'error', $9, $10, NOW())
            `, [
                uuidv4(), clientId, candidateId, campaignId,
                sequenceStep, idempotencyKey,
                phoneNumber, message,
                error.code || 'SMS_FAILED', error.message
            ]);

            logger.error({ error: error.message, candidateId }, 'SMS send failed');
            throw error;
        }
    }

    /**
     * Process incoming SMS webhook from Twilio
     * @param {Object} webhookData - Twilio webhook payload
     * @returns {Promise<Object>}
     */
    static async processIncomingSMS(webhookData) {
        const {
            From: fromNumber,
            To: toNumber,
            Body: body,
            MessageSid: messageSid
        } = webhookData;

        logger.info({ from: fromNumber, body: body?.substring(0, 50) }, 'Incoming SMS received');

        try {
            // Normalize phone number
            const normalizedPhone = fromNumber.replace(/[^0-9+]/g, '');

            // Find candidate by phone number
            const candidateResult = await db.query(`
                SELECT c.id, c.client_id, c.first_name, c.last_name, c.status
                FROM candidates c 
                WHERE c.phone_normalized = $1
                LIMIT 1
            `, [normalizedPhone]);

            if (candidateResult.rows.length === 0) {
                logger.warn({ from: fromNumber }, 'Incoming SMS from unknown number');
                return { status: 'unknown_sender' };
            }

            const candidate = candidateResult.rows[0];

            // Find active campaign for this candidate
            const campaignResult = await db.query(`
                SELECT cc.campaign_id 
                FROM campaign_candidates cc
                WHERE cc.candidate_id = $1 AND cc.status IN ('pending', 'in_sequence')
                ORDER BY cc.enrolled_at DESC LIMIT 1
            `, [candidate.id]);

            const campaignId = campaignResult.rows[0]?.campaign_id || null;

            // Record inbound contact attempt (triggers auto opt-out check via DB trigger)
            await db.query(`
                INSERT INTO contact_attempts (
                    id, client_id, candidate_id, campaign_id,
                    channel, direction, idempotency_key,
                    phone_used, sms_sid, sms_response, status, attempted_at
                ) VALUES ($1, $2, $3, $4, 'sms', 'inbound', $5, $6, $7, $8, 'replied', NOW())
            `, [
                uuidv4(), candidate.client_id, candidate.id, campaignId,
                `inbound:${messageSid}`, fromNumber, messageSid, body
            ]);

            // Check if this is an opt-out keyword
            const optOutKeywords = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel', 'remove', 'quit', 'end'];
            const isOptOut = optOutKeywords.includes(body?.toLowerCase().trim());

            if (isOptOut) {
                // Send opt-out confirmation
                await twilioClient.messages.create({
                    body: 'You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.',
                    from: toNumber,
                    to: fromNumber
                });

                logger.info({ candidateId: candidate.id }, 'Opt-out confirmation sent');
                return { status: 'opted_out', candidateId: candidate.id };
            }

            // Check if positive response (interested)
            const positiveKeywords = ['yes', 'interested', 'sure', 'ok', 'okay', 'yeah', 'yep', 'tell me more', 'available'];
            const isPositive = positiveKeywords.some(kw => body?.toLowerCase().includes(kw));

            if (isPositive) {
                // Update candidate status
                await db.query(
                    `UPDATE candidates SET status = 'engaged', last_responded_at = NOW() WHERE id = $1`,
                    [candidate.id]
                );

                // Update campaign candidate status
                if (campaignId) {
                    await db.query(
                        `UPDATE campaign_candidates SET status = 'responded' WHERE candidate_id = $1 AND campaign_id = $2`,
                        [candidate.id, campaignId]
                    );
                }
            }

            return {
                status: 'received',
                candidateId: candidate.id,
                clientId: candidate.client_id,
                campaignId,
                isPositive,
                body
            };
        } catch (error) {
            logger.error({ error: error.message, from: fromNumber }, 'Failed to process incoming SMS');
            throw error;
        }
    }

    /**
     * Process SMS status callback from Twilio
     * @param {Object} statusData - Status webhook payload
     */
    static async processSMSStatus(statusData) {
        const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = statusData;

        const statusMap = {
            'queued': 'sent',
            'sent': 'sent',
            'delivered': 'delivered',
            'undelivered': 'failed',
            'failed': 'failed'
        };

        const mappedStatus = statusMap[MessageStatus] || MessageStatus;

        try {
            await db.query(`
                UPDATE contact_attempts SET
                    status = $1,
                    error_code = $2,
                    error_message = $3,
                    completed_at = CASE WHEN $1 IN ('delivered', 'failed') THEN NOW() ELSE completed_at END
                WHERE sms_sid = $4
            `, [mappedStatus, ErrorCode, ErrorMessage, MessageSid]);

            logger.debug({ sid: MessageSid, status: mappedStatus }, 'SMS status updated');
        } catch (error) {
            logger.error({ error: error.message, sid: MessageSid }, 'Failed to update SMS status');
        }
    }

    /**
     * Send bulk SMS to a list of candidates
     * @param {Array<Object>} recipients - List of {candidateId, phoneNumber, message}
     * @param {Object} config - Campaign config
     * @returns {Promise<Object>} Results summary
     */
    static async sendBulkSMS(recipients, config) {
        const { campaignId, clientId, delayMs = 100 } = config;
        const results = { sent: 0, skipped: 0, failed: 0, errors: [] };

        for (const recipient of recipients) {
            try {
                const result = await this.sendSMS({
                    candidateId: recipient.candidateId,
                    campaignId,
                    clientId,
                    phoneNumber: recipient.phoneNumber,
                    message: recipient.message,
                    sequenceStep: recipient.sequenceStep || 0
                });

                if (result.status === 'sent') results.sent++;
                else results.skipped++;

                // Rate limiting delay
                if (delayMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    candidateId: recipient.candidateId,
                    error: error.message
                });
            }
        }

        logger.info({ ...results, campaignId }, 'Bulk SMS completed');
        return results;
    }

    /**
     * Validate Twilio webhook signature
     * @param {string} signature - X-Twilio-Signature header
     * @param {string} url - Full request URL
     * @param {Object} params - Request body params
     * @returns {boolean}
     */
    static validateWebhook(signature, url, params) {
        return twilio.validateRequest(
            process.env.TWILIO_AUTH_TOKEN,
            signature,
            url,
            params
        );
    }
}
