// ============================================
// Database Migration Runner
// ============================================

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function runMigrations() {
    const client = await pool.connect();
    
    try {
        // Create migrations tracking table
        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Get already executed migrations
        const executed = await client.query('SELECT name FROM _migrations ORDER BY id');
        const executedNames = new Set(executed.rows.map(r => r.name));

        // Read migration files
        const migrationsDir = path.join(__dirname, 'migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        console.log(`Found ${files.length} migration files`);

        for (const file of files) {
            if (executedNames.has(file)) {
                console.log(`  ⏭️  Skipping ${file} (already executed)`);
                continue;
            }

            console.log(`  🔄 Running ${file}...`);
            
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO _migrations (name) VALUES ($1)',
                    [file]
                );
                await client.query('COMMIT');
                console.log(`  ✅ ${file} completed`);
            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`  ❌ ${file} failed:`, error.message);
                throw error;
            }
        }

        console.log('\n✅ All migrations completed successfully!');
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});
