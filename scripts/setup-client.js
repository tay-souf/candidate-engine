// ============================================
// Client Setup Script
// Reads a client YAML config and provisions them in the database
// ============================================

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function setupClient(configPath) {
    if (!fs.existsSync(configPath)) {
        console.error(`❌ Config file not found: ${configPath}`);
        process.exit(1);
    }

    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    const client = await pool.connect();

    try {
        console.log(`\n🚀 Provisioning client: ${config.client.name}...`);
        await client.query('BEGIN');

        // 1. Create Client
        const clientId = uuidv4();
        await client.query(`
            INSERT INTO clients (
                id, name, slug, ats_type, contact_name, contact_email, contact_phone,
                timezone, max_daily_calls, max_daily_sms, config, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
            ON CONFLICT (slug) DO UPDATE SET
                name = EXCLUDED.name,
                ats_type = EXCLUDED.ats_type,
                config = EXCLUDED.config
            RETURNING id
        `, [
            clientId,
            config.client.name,
            config.client.slug,
            config.ats.platform,
            config.client.contact.name,
            config.client.contact.email,
            config.client.contact.phone,
            config.client.settings.timezone,
            config.client.settings.max_daily_calls,
            config.client.settings.max_daily_sms,
            JSON.stringify(config)
        ]);
        console.log('  ✅ Client record created/updated');

        // 2. ATS Connection
        // We do not store real credentials here for security, they must be added via API/UI
        // We just create the connection skeleton
        const connectionId = uuidv4();
        await client.query(`
            INSERT INTO ats_connections (
                id, client_id, platform, api_url, auth_type, field_mappings, sync_config, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, true)
            ON CONFLICT (client_id, platform) DO UPDATE SET
                api_url = EXCLUDED.api_url,
                field_mappings = EXCLUDED.field_mappings,
                sync_config = EXCLUDED.sync_config
        `, [
            connectionId,
            clientId,
            config.ats.platform,
            config.ats.api_url,
            config.ats.auth_type,
            JSON.stringify(config.ats.field_mappings || {}),
            JSON.stringify(config.ats.sync || {})
        ]);
        console.log('  ✅ ATS connection configured');

        // 3. Recruiters & Calendar
        if (config.scheduling?.recruiters) {
            for (const recruiter of config.scheduling.recruiters) {
                await client.query(`
                    INSERT INTO recruiters (
                        id, client_id, name, email, calendar_type, calendar_id, specialties, availability
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (client_id, email) DO UPDATE SET
                        name = EXCLUDED.name,
                        calendar_type = EXCLUDED.calendar_type,
                        calendar_id = EXCLUDED.calendar_id,
                        availability = EXCLUDED.availability
                `, [
                    uuidv4(),
                    clientId,
                    recruiter.name,
                    recruiter.email,
                    config.scheduling.calendar_type,
                    recruiter.calendar_id,
                    recruiter.specialties || [],
                    JSON.stringify(recruiter.availability || [])
                ]);
            }
            console.log(`  ✅ ${config.scheduling.recruiters.length} recruiters added`);
        }

        // 4. Default Qualification Template
        if (config.qualification?.default_criteria) {
            await client.query(`
                INSERT INTO qualification_templates (
                    id, client_id, name, criteria, passing_score, is_default
                )
                VALUES ($1, $2, 'Default Template', $3, $4, true)
                ON CONFLICT (client_id, name) DO NOTHING
            `, [
                uuidv4(),
                clientId,
                JSON.stringify(config.qualification.default_criteria),
                config.qualification.passing_score || 70
            ]);
            console.log('  ✅ Qualification template created');
        }

        await client.query('COMMIT');
        console.log(`\n🎉 Success! Client "${config.client.name}" provisioned.`);
        console.log(`Client ID: ${clientId}`);
        console.log(`\n⚠️ Note: Remember to set the ATS credentials via the secure API endpoint.`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Setup failed:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

const configArg = process.argv[2];
if (!configArg) {
    console.log('Usage: node setup-client.js <path-to-config.yaml>');
    process.exit(1);
}

setupClient(path.resolve(process.cwd(), configArg));
