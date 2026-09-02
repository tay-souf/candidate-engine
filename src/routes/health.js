// ============================================
// Health Check Routes
// ============================================

import { Router } from 'express';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';

const router = Router();

router.get('/', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        service: 'stratton-candidate-engine',
        checks: {}
    };

    // Database check
    try {
        const start = Date.now();
        await db.query('SELECT 1');
        health.checks.database = { status: 'ok', latency: `${Date.now() - start}ms` };
    } catch (error) {
        health.checks.database = { status: 'error', message: error.message };
        health.status = 'degraded';
    }

    // Redis check
    try {
        const start = Date.now();
        await redis.ping();
        health.checks.redis = { status: 'ok', latency: `${Date.now() - start}ms` };
    } catch (error) {
        health.checks.redis = { status: 'error', message: error.message };
        health.status = 'degraded';
    }

    // Memory check
    const memory = process.memoryUsage();
    health.checks.memory = {
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`
    };

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
});

// Detailed system stats
router.get('/stats', async (req, res) => {
    try {
        const stats = {};

        // Client count
        const clients = await db.query(`SELECT COUNT(*) FROM clients WHERE status = 'active'`);
        stats.active_clients = parseInt(clients.rows[0].count);

        // Campaign stats
        const campaigns = await db.query(`
            SELECT status, COUNT(*) 
            FROM campaigns 
            GROUP BY status
        `);
        stats.campaigns = Object.fromEntries(campaigns.rows.map(r => [r.status, parseInt(r.count)]));

        // Today's activity
        const today = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE channel = 'sms' AND direction = 'outbound') as sms_sent,
                COUNT(*) FILTER (WHERE channel = 'voice' AND direction = 'outbound') as calls_made,
                COUNT(*) FILTER (WHERE direction = 'inbound') as responses,
                COUNT(*) FILTER (WHERE status = 'opted_out') as opt_outs
            FROM contact_attempts 
            WHERE attempted_at >= CURRENT_DATE
        `);
        stats.today = today.rows[0];

        // Total candidates
        const candidates = await db.query(`SELECT COUNT(*) FROM candidates`);
        stats.total_candidates = parseInt(candidates.rows[0].count);

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export { router as healthRoutes };
