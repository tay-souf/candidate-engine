// ============================================
// Webhook Routes - Retell AI, Twilio, ATS
// ============================================

import { Router } from 'express';
import { RetellCallHandler } from '../../integrations/retell/call-handler.js';
import { TwilioSMSHandler } from '../../integrations/twilio/sms-handler.js';
import { createLogger } from '../lib/logger.js';
import crypto from 'crypto';

const router = Router();
const logger = createLogger({ module: 'Webhooks' });

// ============================================
// Retell AI Webhooks
// ============================================

/**
 * POST /api/webhooks/retell/call-status
 * Called by Retell AI when a call ends or status changes
 */
router.post('/retell/call-status', async (req, res) => {
    try {
        // Verify webhook signature (optional, recommended)
        const signature = req.headers['x-retell-signature'];
        if (process.env.RETELL_WEBHOOK_SECRET && signature) {
            const expected = crypto
                .createHmac('sha256', process.env.RETELL_WEBHOOK_SECRET)
                .update(JSON.stringify(req.body))
                .digest('hex');
            if (signature !== expected) {
                logger.warn('Invalid Retell webhook signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        const result = await RetellCallHandler.processCallWebhook(req.body);
        
        logger.info({ 
            callId: req.body.call_id, 
            status: result.status 
        }, 'Retell webhook processed');

        res.json({ success: true, ...result });
    } catch (error) {
        logger.error({ error: error.message }, 'Retell webhook error');
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ============================================
// Twilio Webhooks
// ============================================

/**
 * POST /api/webhooks/twilio/incoming-sms
 * Called by Twilio when an SMS is received
 */
router.post('/twilio/incoming-sms', async (req, res) => {
    try {
        // Validate Twilio signature
        const signature = req.headers['x-twilio-signature'];
        const url = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/twilio/incoming-sms`;
        
        if (process.env.NODE_ENV === 'production') {
            const isValid = TwilioSMSHandler.validateWebhook(signature, url, req.body);
            if (!isValid) {
                logger.warn('Invalid Twilio webhook signature');
                return res.status(403).send('Forbidden');
            }
        }

        const result = await TwilioSMSHandler.processIncomingSMS(req.body);
        
        // Respond with TwiML (empty response = no auto-reply)
        res.type('text/xml');
        
        if (result.status === 'opted_out') {
            // Opt-out confirmation is sent separately via API
            res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        } else {
            res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }
    } catch (error) {
        logger.error({ error: error.message }, 'Twilio incoming SMS webhook error');
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
});

/**
 * POST /api/webhooks/twilio/sms-status
 * Called by Twilio for SMS delivery status updates
 */
router.post('/twilio/sms-status', async (req, res) => {
    try {
        await TwilioSMSHandler.processSMSStatus(req.body);
        res.sendStatus(200);
    } catch (error) {
        logger.error({ error: error.message }, 'Twilio SMS status webhook error');
        res.sendStatus(200); // Always return 200 to avoid retries
    }
});

// ============================================
// ATS Webhooks (for real-time updates)
// ============================================

/**
 * POST /api/webhooks/ats/:platform
 * Generic ATS webhook handler
 */
router.post('/ats/:platform', async (req, res) => {
    const { platform } = req.params;
    
    try {
        // Verify webhook secret
        const webhookSecret = req.headers['x-webhook-secret'];
        if (process.env.WEBHOOK_SECRET && webhookSecret !== process.env.WEBHOOK_SECRET) {
            return res.status(401).json({ error: 'Invalid webhook secret' });
        }

        logger.info({ 
            platform, 
            event: req.body.event || req.body.type 
        }, 'ATS webhook received');

        // Process based on event type
        const eventType = req.body.event || req.body.type || 'unknown';
        
        switch (eventType) {
            case 'job.created':
            case 'job_order.created':
                // New job order - could trigger candidate matching
                logger.info({ jobId: req.body.data?.id }, 'New job order webhook');
                break;
                
            case 'candidate.updated':
            case 'candidate.created':
                // Candidate data changed in ATS
                logger.info({ candidateId: req.body.data?.id }, 'Candidate update webhook');
                break;
                
            case 'placement.created':
                // Candidate was placed - stop outreach
                logger.info({ candidateId: req.body.data?.candidate_id }, 'Placement webhook');
                break;
                
            default:
                logger.debug({ eventType }, 'Unhandled ATS webhook event');
        }

        res.json({ success: true, event: eventType });
    } catch (error) {
        logger.error({ error: error.message, platform }, 'ATS webhook error');
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export { router as webhookRoutes };
