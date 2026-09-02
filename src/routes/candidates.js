// ============================================
// Candidate Routes
// ============================================

import { Router } from 'express';
import { db } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';

const router = Router();
const logger = createLogger({ module: 'CandidateRoutes' });

// Search candidates
router.get('/', async (req, res) => {
    try {
        const { client_id, status, skills, city, state, search, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        let paramIdx = 1;
        let conditions = [];

        if (client_id) { conditions.push(`client_id = $${paramIdx++}`); params.push(client_id); }
        if (status) { conditions.push(`status = $${paramIdx++}`); params.push(status); }
        if (city) { conditions.push(`city ILIKE $${paramIdx++}`); params.push(`%${city}%`); }
        if (state) { conditions.push(`state = $${paramIdx++}`); params.push(state); }
        if (skills) { conditions.push(`skills && $${paramIdx++}`); params.push(skills.split(',')); }
        if (search) {
            conditions.push(`to_tsvector('english', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(current_title,'')) @@ plainto_tsquery($${paramIdx++})`);
            params.push(search);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        
        const result = await db.query(
            `SELECT id, client_id, ats_candidate_id, first_name, last_name, full_name,
                    email, phone, city, state, current_title, skills, status,
                    last_contacted_at, total_contact_attempts, total_responses
             FROM candidates ${where}
             ORDER BY updated_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, limit, offset]
        );

        const countResult = await db.query(`SELECT COUNT(*) FROM candidates ${where}`, params);

        res.json({
            data: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: Number(page),
            limit: Number(limit)
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to search candidates');
        res.status(500).json({ error: error.message });
    }
});

// Get candidate by ID
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM candidates WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Candidate not found' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get candidate contact history
router.get('/:id/history', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM contact_attempts 
            WHERE candidate_id = $1 
            ORDER BY attempted_at DESC LIMIT 50
        `, [req.params.id]);
        res.json({ data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get candidate qualifications
router.get('/:id/qualifications', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT * FROM qualifications 
            WHERE candidate_id = $1 
            ORDER BY qualified_at DESC
        `, [req.params.id]);
        res.json({ data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get candidate appointments
router.get('/:id/appointments', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT a.*, r.name as recruiter_name, r.email as recruiter_email
            FROM appointments a
            JOIN recruiters r ON r.id = a.recruiter_id
            WHERE a.candidate_id = $1 
            ORDER BY a.scheduled_start DESC
        `, [req.params.id]);
        res.json({ data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update candidate status
router.patch('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const result = await db.query(
            `UPDATE candidates SET status = $1 WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Candidate not found' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export { router as candidateRoutes };
