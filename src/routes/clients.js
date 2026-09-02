// ============================================
// Client Routes
// ============================================

import { Router } from 'express';
import { db } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { createATSAdapter, getSupportedPlatforms } from '../../integrations/ats-adapters/adapter-factory.js';

const router = Router();
const logger = createLogger({ module: 'ClientRoutes' });

// List all clients
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM clients ORDER BY created_at DESC`);
        res.json({ data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get supported platforms
router.get('/platforms', (req, res) => {
    res.json({ platforms: getSupportedPlatforms() });
});

// Get client by ID
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        
        // Get ATS connection
        const atsResult = await db.query(
            `SELECT id, platform, api_url, auth_type, is_active, last_sync_at, sync_status FROM ats_connections WHERE client_id = $1`,
            [req.params.id]
        );
        
        // Get recruiters
        const recruitersResult = await db.query(
            `SELECT id, name, email, specialties, is_active FROM recruiters WHERE client_id = $1`,
            [req.params.id]
        );

        res.json({
            ...result.rows[0],
            ats_connections: atsResult.rows,
            recruiters: recruitersResult.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new client
router.post('/', async (req, res) => {
    try {
        const {
            name, slug, ats_type, contact_name, contact_email, contact_phone,
            timezone, max_daily_calls, max_daily_sms, config
        } = req.body;

        const result = await db.query(`
            INSERT INTO clients (id, name, slug, ats_type, contact_name, contact_email, contact_phone,
                                 timezone, max_daily_calls, max_daily_sms, config)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            uuidv4(), name, slug || name.toLowerCase().replace(/\s+/g, '-'),
            ats_type, contact_name, contact_email, contact_phone,
            timezone || 'America/New_York',
            max_daily_calls || 500, max_daily_sms || 1000,
            JSON.stringify(config || {})
        ]);

        logger.info({ clientId: result.rows[0].id, name }, 'Client created');
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to create client');
        res.status(500).json({ error: error.message });
    }
});

// Test ATS connection
router.post('/:id/test-connection', async (req, res) => {
    try {
        const connectionResult = await db.query(
            `SELECT * FROM ats_connections WHERE client_id = $1 AND is_active = true LIMIT 1`,
            [req.params.id]
        );
        
        if (connectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'No active ATS connection found' });
        }

        const adapter = createATSAdapter(connectionResult.rows[0]);
        const success = await adapter.testConnection();
        
        res.json({ connected: success });
    } catch (error) {
        res.status(500).json({ error: error.message, connected: false });
    }
});

// Get client activity summary
router.get('/:id/activity', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM daily_activity_summary 
            WHERE client_id = $1 
            ORDER BY activity_date DESC LIMIT 30
        `, [req.params.id]);
        res.json({ data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export { router as clientRoutes };
