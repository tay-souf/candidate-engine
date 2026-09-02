// ============================================
// Appointment Routes
// ============================================

import { Router } from 'express';
import { db } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { GoogleCalendarService } from '../../integrations/calendar/google-calendar.js';
import { Microsoft365CalendarService } from '../../integrations/calendar/microsoft-365.js';

const router = Router();
const logger = createLogger({ module: 'AppointmentRoutes' });

// List appointments
router.get('/', async (req, res) => {
    try {
        const { client_id, recruiter_id, status, from, to, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        const conditions = [];
        let idx = 1;

        if (client_id) { conditions.push(`a.client_id = $${idx++}`); params.push(client_id); }
        if (recruiter_id) { conditions.push(`a.recruiter_id = $${idx++}`); params.push(recruiter_id); }
        if (status) { conditions.push(`a.status = $${idx++}`); params.push(status); }
        if (from) { conditions.push(`a.scheduled_start >= $${idx++}`); params.push(from); }
        if (to) { conditions.push(`a.scheduled_start <= $${idx++}`); params.push(to); }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await db.query(`
            SELECT a.*, 
                   c.first_name || ' ' || c.last_name as candidate_name,
                   c.phone as candidate_phone,
                   r.name as recruiter_name,
                   r.email as recruiter_email
            FROM appointments a
            JOIN candidates c ON c.id = a.candidate_id
            JOIN recruiters r ON r.id = a.recruiter_id
            ${where}
            ORDER BY a.scheduled_start ASC
            LIMIT $${idx++} OFFSET $${idx++}
        `, [...params, limit, offset]);

        res.json({ data: result.rows, page: Number(page), limit: Number(limit) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get available slots
router.get('/available-slots', async (req, res) => {
    try {
        const { recruiter_id, date, days = 5, duration = 30 } = req.query;
        
        if (!recruiter_id) return res.status(400).json({ error: 'recruiter_id is required' });

        const startDate = date ? new Date(date) : new Date();
        const slots = [];

        for (let d = 0; d < days; d++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(currentDate.getDate() + d);
            const dateStr = currentDate.toISOString().split('T')[0];

            const result = await db.query(
                `SELECT * FROM find_available_slots($1, $2::DATE, $3)`,
                [recruiter_id, dateStr, duration]
            );

            slots.push(...result.rows.map(row => ({
                date: dateStr,
                start: row.slot_start,
                end: row.slot_end
            })));
        }

        res.json({ slots });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create appointment
router.post('/', async (req, res) => {
    try {
        const {
            client_id, candidate_id, recruiter_id, campaign_id, job_order_id,
            scheduled_start, scheduled_end, duration_minutes, meeting_type,
            timezone, notes
        } = req.body;

        const appointmentId = uuidv4();
        const endTime = scheduled_end || new Date(
            new Date(scheduled_start).getTime() + (duration_minutes || 30) * 60000
        ).toISOString();

        // Get recruiter info for calendar integration
        const recruiterResult = await db.query(
            `SELECT * FROM recruiters WHERE id = $1`, [recruiter_id]
        );
        const recruiter = recruiterResult.rows[0];

        // Get candidate info
        const candidateResult = await db.query(
            `SELECT * FROM candidates WHERE id = $1`, [candidate_id]
        );
        const candidate = candidateResult.rows[0];

        let calendarEventId = null;
        let calendarLink = null;
        let meetingLink = null;

        // Create calendar event if configured
        if (recruiter?.calendar_type && recruiter?.calendar_id) {
            try {
                const eventDetails = {
                    summary: `Interview: ${candidate.first_name} ${candidate.last_name}`,
                    description: `Candidate interview scheduled by Stratton Candidate Engine\n\nCandidate: ${candidate.first_name} ${candidate.last_name}\nPhone: ${candidate.phone}\nEmail: ${candidate.email || 'N/A'}`,
                    startTime: new Date(scheduled_start),
                    endTime: new Date(endTime),
                    attendees: [candidate.email, recruiter.email].filter(Boolean),
                    location: meeting_type === 'in_person' ? 'Office' : undefined
                };

                if (recruiter.calendar_type === 'google') {
                    const calendarService = new GoogleCalendarService(
                        JSON.parse(recruiter.calendar_credentials_encrypted || '{}')
                    );
                    const event = await calendarService.createEvent({
                        calendarId: recruiter.calendar_id,
                        ...eventDetails
                    });
                    calendarEventId = event.eventId;
                    calendarLink = event.htmlLink;
                    meetingLink = event.meetingLink;
                } else if (recruiter.calendar_type === 'microsoft') {
                    const calendarService = new Microsoft365CalendarService(
                        JSON.parse(recruiter.calendar_credentials_encrypted || '{}')
                    );
                    const event = await calendarService.createEvent({
                        userId: recruiter.calendar_id,
                        ...eventDetails,
                        isOnline: meeting_type === 'video'
                    });
                    calendarEventId = event.eventId;
                    calendarLink = event.htmlLink;
                    meetingLink = event.meetingLink;
                }
            } catch (calError) {
                logger.error({ error: calError.message }, 'Failed to create calendar event');
            }
        }

        // Insert appointment
        const result = await db.query(`
            INSERT INTO appointments (
                id, client_id, candidate_id, recruiter_id, campaign_id, job_order_id,
                scheduled_start, scheduled_end, timezone, duration_minutes,
                calendar_type, calendar_event_id, calendar_link,
                meeting_type, meeting_link, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'scheduled')
            RETURNING *
        `, [
            appointmentId, client_id, candidate_id, recruiter_id, campaign_id, job_order_id,
            scheduled_start, endTime, timezone || 'America/New_York', duration_minutes || 30,
            recruiter?.calendar_type, calendarEventId, calendarLink,
            meeting_type || 'phone', meetingLink, notes
        ]);

        // Update candidate status
        await db.query(
            `UPDATE candidates SET status = 'scheduled' WHERE id = $1`,
            [candidate_id]
        );

        logger.info({ appointmentId, candidateId: candidate_id, recruiterId: recruiter_id }, 'Appointment created');
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error({ error: error.message }, 'Failed to create appointment');
        res.status(500).json({ error: error.message });
    }
});

// Cancel appointment
router.post('/:id/cancel', async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await db.query(`
            UPDATE appointments SET status = 'cancelled', cancellation_reason = $1
            WHERE id = $2 RETURNING *
        `, [reason, req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Appointment not found' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export { router as appointmentRoutes };
