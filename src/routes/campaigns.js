// ============================================
// Campaign Routes
// ============================================

import { Router } from 'express';
import { db } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const logger = createLogger({ module: 'CampaignRoutes' });

// List campaigns
router.get('/', async (req, res) => {
    try {
        const { client_id, status, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `SELECT * FROM campaign_dashboard WHERE 1=1`;
        const params = [];
        let paramIdx = 1;

        if (client_id) { query += ` AND client_id = $${paramIdx++}`; params.push(client_id); }
        if (status) { query += ` AND status = $${paramIdx++}`; params.push(status); }
        
        query += ` ORDER BY started_at DESC NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        res.json({ data: result.rows, page: Number(page), limit: Number(limit) });
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to list campaigns');
        res.status(500).json({ error: error.message });
    }
});

// Get campaign by ID
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create campaign
router.post('/', async (req, res) => {
    try {
        const {
            client_id, job_order_id, name, description, campaign_type,
            outreach_channels, sequence_config, qualification_criteria,
            target_query, max_candidates, scheduled_start
        } = req.body;

        const result = await db.query(`
            INSERT INTO campaigns (
                id, client_id, job_order_id, name, description, campaign_type,
                outreach_channels, sequence_config, qualification_criteria,
                target_query, max_candidates, scheduled_start
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            uuidv4(), client_id, job_order_id, name, description,
            campaign_type || 'outreach',
            outreach_channels || ['sms'],
            JSON.stringify(sequence_config || {}),
            JSON.stringify(qualification_criteria || {}),
            JSON.stringify(target_query || {}),
            max_candidates, scheduled_start
        ]);

        logger.info({ campaignId: result.rows[0].id, name }, 'Campaign created');
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to create campaign');
        res.status(500).json({ error: error.message });
    }
});

// Update campaign
router.patch('/:id', async (req, res) => {
    try {
        const updates = req.body;
        const setClauses = [];
        const params = [];
        let idx = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (['name', 'description', 'status', 'sequence_config', 'qualification_criteria'].includes(key)) {
                setClauses.push(`${key} = $${idx++}`);
                params.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
        }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

        params.push(req.params.id);
        const result = await db.query(
            `UPDATE campaigns SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start campaign
router.post('/:id/start', async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE campaigns SET status = 'active', started_at = NOW() WHERE id = $1 AND status IN ('draft', 'paused') RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(400).json({ error: 'Campaign cannot be started' });
        
        logger.info({ campaignId: req.params.id }, 'Campaign started');
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Pause campaign
router.post('/:id/pause', async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE campaigns SET status = 'paused' WHERE id = $1 AND status = 'active' RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(400).json({ error: 'Campaign cannot be paused' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get campaign candidates
router.get('/:id/candidates', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT cc.*, c.first_name, c.last_name, c.phone, c.email, c.status as candidate_status
            FROM campaign_candidates cc
            JOIN candidates c ON c.id = cc.candidate_id
            WHERE cc.campaign_id = $1
            ORDER BY cc.enrolled_at DESC
        `, [req.params.id]);
        
        res.json({ data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get campaign stats
router.get('/:id/stats', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM campaign_dashboard WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export { router as campaignRoutes };
