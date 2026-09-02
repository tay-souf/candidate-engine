// ============================================
// Database Seed Data
// Populates test data for development
// ============================================

import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function seed() {
    const client = await pool.connect();

    try {
        console.log('🌱 Seeding database...\n');

        // Create demo client
        const clientId = uuidv4();
        await client.query(`
            INSERT INTO clients (id, name, slug, ats_type, status, contact_name, contact_email, contact_phone, timezone)
            VALUES ($1, 'Demo Staffing Co', 'demo-staffing', 'bullhorn', 'active', 'John Smith', 'john@demo-staffing.com', '+15551234567', 'America/New_York')
            ON CONFLICT (slug) DO NOTHING
        `, [clientId]);
        console.log('  ✅ Demo client created');

        // Create demo recruiter
        const recruiterId = uuidv4();
        await client.query(`
            INSERT INTO recruiters (id, client_id, name, email, phone, specialties, is_active)
            VALUES ($1, $2, 'Sarah Johnson', 'sarah@demo-staffing.com', '+15559876543', '{IT,Healthcare,Engineering}', true)
        `, [recruiterId, clientId]);
        console.log('  ✅ Demo recruiter created');

        // Create demo job order
        const jobId = uuidv4();
        await client.query(`
            INSERT INTO job_orders (id, client_id, ats_job_id, title, description, location, job_type, pay_rate_min, pay_rate_max, pay_type, skills_required, openings, status, assigned_recruiter_id)
            VALUES ($1, $2, 'JOB-001', 'Registered Nurse - ICU', 'Seeking experienced ICU nurse for a 13-week travel assignment.', 'New York, NY', 'contract', 45.00, 55.00, 'hourly', '{ICU,BLS,ACLS,Critical Care}', 3, 'active', $3)
        `, [jobId, clientId, recruiterId]);
        console.log('  ✅ Demo job order created');

        // Create demo candidates
        const candidates = [
            { first: 'Maria', last: 'Garcia', phone: '+15551000001', email: 'maria@example.com', title: 'ICU Nurse', skills: ['ICU', 'BLS', 'ACLS'], exp: 5 },
            { first: 'James', last: 'Wilson', phone: '+15551000002', email: 'james@example.com', title: 'Travel Nurse', skills: ['ICU', 'BLS'], exp: 3 },
            { first: 'Emily', last: 'Chen', phone: '+15551000003', email: 'emily@example.com', title: 'RN', skills: ['ICU', 'ACLS', 'PALS'], exp: 7 },
            { first: 'Michael', last: 'Brown', phone: '+15551000004', email: 'michael@example.com', title: 'Critical Care Nurse', skills: ['Critical Care', 'BLS'], exp: 2 },
            { first: 'Sarah', last: 'Davis', phone: '+15551000005', email: 'sarah.d@example.com', title: 'ICU RN', skills: ['ICU', 'BLS', 'ACLS', 'CCRN'], exp: 10 },
        ];

        for (const c of candidates) {
            await client.query(`
                INSERT INTO candidates (id, client_id, ats_candidate_id, first_name, last_name, phone, email, current_title, skills, experience_years, city, state, status, availability)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'New York', 'NY', 'new', 'immediate')
            `, [uuidv4(), clientId, `CAND-${Math.random().toString(36).substr(2, 6)}`, c.first, c.last, c.phone, c.email, c.title, c.skills, c.exp]);
        }
        console.log(`  ✅ ${candidates.length} demo candidates created`);

        // Create demo outreach templates
        const templates = [
            { name: 'Initial SMS', channel: 'sms', type: 'initial_outreach', body: 'Hi {{candidate_name}}! {{company_name}} here. We have a {{job_title}} opportunity in {{location}} paying {{pay_rate}}. Interested? Reply YES or STOP to opt out.' },
            { name: 'Follow-up SMS', channel: 'sms', type: 'follow_up', body: 'Hi {{candidate_name}}, following up on the {{job_title}} position. Still interested? Reply YES or STOP to opt out.' },
            { name: 'Scheduling SMS', channel: 'sms', type: 'scheduling', body: 'Hi {{candidate_name}}! Your interview is confirmed for {{appointment_date}} at {{appointment_time}} with {{recruiter_name}}.' },
        ];

        for (const t of templates) {
            await client.query(`
                INSERT INTO outreach_templates (id, client_id, name, channel, template_type, body, is_default)
                VALUES ($1, $2, $3, $4, $5, $6, true)
            `, [uuidv4(), clientId, t.name, t.channel, t.type, t.body]);
        }
        console.log(`  ✅ ${templates.length} outreach templates created`);

        // Create default qualification template
        await client.query(`
            INSERT INTO qualification_templates (id, client_id, name, job_category, criteria, passing_score, is_default)
            VALUES ($1, $2, 'Healthcare Default', 'Healthcare', $3, 70, true)
        `, [uuidv4(), clientId, JSON.stringify([
            { field: 'experience_years', operator: '>=', value: 2, weight: 0.3, required: false, label: 'Experience' },
            { field: 'availability', operator: 'in', value: ['immediate', '1_week', '2_weeks'], weight: 0.25, required: true, label: 'Availability' },
            { field: 'certifications', operator: 'contains_any', value: ['BLS', 'ACLS'], weight: 0.25, required: false, label: 'Certifications' },
            { field: 'location_radius', operator: '<=', value: 50, weight: 0.2, required: false, label: 'Location' }
        ])]);
        console.log('  ✅ Default qualification template created');

        console.log('\n✅ Seed completed! Demo client ID:', clientId);

    } catch (error) {
        console.error('❌ Seed failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

seed().catch(() => process.exit(1));
