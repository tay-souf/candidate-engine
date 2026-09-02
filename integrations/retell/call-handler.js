// ============================================
// Retell AI Integration - Voice Call Handler
// ============================================

import Retell from 'retell-sdk';
import { createLogger } from '../../src/lib/logger.js';
import { db } from '../../src/lib/database.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger({ module: 'RetellAI' });

// Initialize Retell client
const retellClient = new Retell({
    apiKey: process.env.RETELL_API_KEY
});

/**
 * Retell AI Call Handler
 * Manages outbound AI voice calls for candidate outreach
 */
export class RetellCallHandler {

    /**
     * Create a Retell AI agent for a specific campaign
     * @param {Object} config - Agent configuration
     * @returns {Promise<Object>} Created agent
     */
    static async createAgent(config) {
        const {
            agentName,
            voiceId = 'eleven_labs_rachel',  // Default female voice
            prompt,
            language = 'en-US',
            maxCallDuration = 300  // 5 minutes
        } = config;

        try {
            const agent = await retellClient.agent.create({
                agent_name: agentName,
                voice_id: voiceId,
                response_engine: {
                    type: 'retell-llm',
                    llm_id: config.llmId || undefined
                },
                language,
                max_call_duration_ms: maxCallDuration * 1000,
                enable_backchannel: true,
                ambient_sound: 'office',
                responsiveness: 0.8,
                interruption_sensitivity: 0.7,
                reminder_trigger_ms: 10000,
                reminder_max_count: 2,
                end_call_after_silence_ms: 8000,
                webhook_url: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/retell/call-status`,
                post_call_analysis_data: [
                    { name: 'candidate_interested', type: 'boolean', description: 'Whether the candidate expressed interest in the job opportunity' },
                    { name: 'availability', type: 'string', description: 'When the candidate is available to start' },
                    { name: 'desired_pay', type: 'string', description: 'The pay rate the candidate is looking for' },
                    { name: 'call_sentiment', type: 'enum', choices: ['positive', 'neutral', 'negative'], description: 'Overall sentiment of the call' },
                    { name: 'opt_out', type: 'boolean', description: 'Whether the candidate requested to not be contacted again' },
                    { name: 'summary', type: 'string', description: 'Brief summary of the conversation' },
                    { name: 'qualified', type: 'boolean', description: 'Whether candidate meets basic qualifications discussed' }
                ]
            });

            logger.info({ agentId: agent.agent_id }, 'Retell AI agent created');
            return agent;
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to create Retell agent');
            throw error;
        }
    }

    /**
     * Create an LLM for the agent with custom prompt
     * @param {Object} config - LLM configuration  
     * @returns {Promise<Object>}
     */
    static async createLLM(config) {
        const { prompt, model = 'gpt-4o', beginMessage } = config;

        try {
            const llm = await retellClient.llm.create({
                model,
                general_prompt: prompt,
                begin_message: beginMessage,
                general_tools: [
                    {
                        type: 'end_call',
                        name: 'end_call',
                        description: 'End the call when the conversation is complete or candidate wants to stop'
                    },
                    {
                        type: 'transfer_call',
                        name: 'transfer_to_recruiter',
                        description: 'Transfer the call to a live recruiter when requested',
                        number: config.transferNumber || process.env.TWILIO_PHONE_NUMBER
                    }
                ]
            });

            logger.info({ llmId: llm.llm_id }, 'Retell LLM created');
            return llm;
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to create Retell LLM');
            throw error;
        }
    }

    /**
     * Initiate an outbound call to a candidate
     * @param {Object} params - Call parameters
     * @returns {Promise<Object>} Call details
     */
    static async makeCall(params) {
        const {
            candidateId,
            campaignId,
            clientId,
            phoneNumber,
            agentId,
            retellAgentId,
            metadata = {}
        } = params;

        // Generate idempotency key
        const idempotencyKey = `call:${campaignId}:${candidateId}:${Date.now()}`;

        try {
            // Check opt-out before calling
            const optOutCheck = await db.query(
                `SELECT is_opted_out($1, 'voice') as opted_out`,
                [candidateId]
            );
            
            if (optOutCheck.rows[0]?.opted_out) {
                logger.warn({ candidateId }, 'Candidate has opted out of voice calls');
                return { status: 'skipped', reason: 'opted_out' };
            }

            // Check duplicate contact
            const dupCheck = await db.query(
                `SELECT check_duplicate_contact($1, $2, 'voice', 24) as can_contact`,
                [candidateId, campaignId]
            );
            
            if (!dupCheck.rows[0]?.can_contact) {
                logger.warn({ candidateId }, 'Duplicate contact prevented');
                return { status: 'skipped', reason: 'duplicate' };
            }

            // Create the call via Retell API
            const call = await retellClient.call.createPhoneCall({
                from_number: process.env.TWILIO_PHONE_NUMBER,
                to_number: phoneNumber,
                override_agent_id: retellAgentId || agentId,
                metadata: {
                    candidate_id: candidateId,
                    campaign_id: campaignId,
                    client_id: clientId,
                    idempotency_key: idempotencyKey,
                    ...metadata
                },
                retell_llm_dynamic_variables: {
                    candidate_name: metadata.candidate_name || 'there',
                    job_title: metadata.job_title || 'the position',
                    company_name: metadata.company_name || 'our client',
                    pay_rate: metadata.pay_rate || 'competitive pay',
                    location: metadata.location || '',
                    recruiter_name: metadata.recruiter_name || 'our team'
                }
            });

            // Record the contact attempt
            await db.query(`
                INSERT INTO contact_attempts (
                    id, client_id, candidate_id, campaign_id, 
                    channel, direction, idempotency_key,
                    phone_used, retell_call_id, status, attempted_at
                ) VALUES ($1, $2, $3, $4, 'voice', 'outbound', $5, $6, $7, 'pending', NOW())
            `, [
                uuidv4(), clientId, candidateId, campaignId,
                idempotencyKey, phoneNumber, call.call_id
            ]);

            logger.info({ 
                callId: call.call_id, 
                candidateId, 
                phone: phoneNumber.slice(-4) 
            }, 'Retell AI call initiated');

            return {
                status: 'initiated',
                call_id: call.call_id,
                idempotency_key: idempotencyKey
            };
        } catch (error) {
            // Record failed attempt
            await db.query(`
                INSERT INTO contact_attempts (
                    id, client_id, candidate_id, campaign_id,
                    channel, direction, idempotency_key,
                    phone_used, status, error_code, error_message, attempted_at
                ) VALUES ($1, $2, $3, $4, 'voice', 'outbound', $5, $6, 'error', $7, $8, NOW())
            `, [
                uuidv4(), clientId, candidateId, campaignId,
                idempotencyKey, phoneNumber,
                error.code || 'CALL_FAILED', error.message
            ]);

            logger.error({ error: error.message, candidateId }, 'Retell AI call failed');
            throw error;
        }
    }

    /**
     * Process Retell AI call webhook (call completed)
     * @param {Object} webhookData - Webhook payload from Retell
     * @returns {Promise<Object>}
     */
    static async processCallWebhook(webhookData) {
        const {
            call_id,
            call_status,
            transcript,
            recording_url,
            call_analysis,
            duration_ms,
            disconnection_reason,
            metadata
        } = webhookData;

        const candidateId = metadata?.candidate_id;
        const campaignId = metadata?.campaign_id;
        const clientId = metadata?.client_id;

        logger.info({ callId: call_id, status: call_status }, 'Processing Retell call webhook');

        try {
            // Map Retell status to our status
            const statusMap = {
                'ended': 'answered',
                'transferred': 'answered',
                'error': 'error',
                'voicemail': 'voicemail',
                'no-answer': 'no_answer',
                'busy': 'busy'
            };
            const mappedStatus = statusMap[call_status] || call_status;

            // Extract AI analysis
            const aiAnalysis = call_analysis || {};
            const sentiment = aiAnalysis.call_sentiment || 'neutral';
            const isInterested = aiAnalysis.candidate_interested === true;
            const wantsOptOut = aiAnalysis.opt_out === true;
            const isQualified = aiAnalysis.qualified === true;

            // Update contact attempt record
            await db.query(`
                UPDATE contact_attempts SET
                    status = $1,
                    call_duration_seconds = $2,
                    call_recording_url = $3,
                    call_transcript = $4,
                    call_sentiment = $5,
                    ai_summary = $6,
                    ai_qualification = $7,
                    ai_intent = $8,
                    ai_confidence = $9,
                    completed_at = NOW()
                WHERE retell_call_id = $10
            `, [
                mappedStatus,
                Math.round((duration_ms || 0) / 1000),
                recording_url,
                transcript,
                sentiment,
                aiAnalysis.summary || null,
                JSON.stringify(aiAnalysis),
                isInterested ? 'interested' : (wantsOptOut ? 'opt_out' : 'not_interested'),
                aiAnalysis.confidence || 0.8,
                call_id
            ]);

            // Handle opt-out
            if (wantsOptOut && candidateId) {
                await db.query(`
                    INSERT INTO opt_outs (id, client_id, candidate_id, channel, reason, source)
                    VALUES ($1, $2, $3, 'voice', 'Requested during AI call', 'voice_request')
                    ON CONFLICT (client_id, candidate_id, channel) DO UPDATE
                    SET is_active = true, opted_out_at = NOW()
                `, [uuidv4(), clientId, candidateId]);

                await db.query(
                    `UPDATE candidates SET status = 'opted_out' WHERE id = $1`,
                    [candidateId]
                );

                // Stop all active sequences
                await db.query(`
                    UPDATE campaign_candidates SET status = 'opted_out', completed_at = NOW()
                    WHERE candidate_id = $1 AND status IN ('pending', 'in_sequence')
                `, [candidateId]);

                logger.info({ candidateId, callId: call_id }, 'Candidate opted out during call');
            }

            // If interested and qualified, trigger qualification workflow
            if (isInterested && mappedStatus === 'answered' && candidateId) {
                await db.query(
                    `UPDATE candidates SET status = 'engaged' WHERE id = $1 AND status IN ('new', 'contacted')`,
                    [candidateId]
                );

                // Store qualification result if available
                if (isQualified) {
                    await db.query(`
                        INSERT INTO qualifications (id, client_id, candidate_id, campaign_id, qualified, 
                            overall_score, ai_analysis, ai_summary, source)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'voice_call')
                    `, [
                        uuidv4(), clientId, candidateId, campaignId,
                        true, 85.0,
                        JSON.stringify(aiAnalysis),
                        aiAnalysis.summary
                    ]);
                }
            }

            return {
                processed: true,
                call_id,
                status: mappedStatus,
                interested: isInterested,
                opted_out: wantsOptOut,
                qualified: isQualified
            };
        } catch (error) {
            logger.error({ error: error.message, callId: call_id }, 'Failed to process call webhook');
            throw error;
        }
    }

    /**
     * Get call details from Retell
     * @param {string} callId 
     * @returns {Promise<Object>}
     */
    static async getCallDetails(callId) {
        return retellClient.call.retrieve(callId);
    }

    /**
     * List all agents
     * @returns {Promise<Array>}
     */
    static async listAgents() {
        return retellClient.agent.list();
    }
}
