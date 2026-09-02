// ============================================
// Database Connection Pool - PostgreSQL
// ============================================

import pg from 'pg';
import { logger } from './logger.js';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: false,
});

pool.on('error', (err) => {
    logger.error({ error: err.message }, 'Unexpected database pool error');
});

pool.on('connect', () => {
    logger.debug('New database connection established');
});

/**
 * Database wrapper with client-scoped RLS
 */
export const db = {
    /**
     * Execute a query
     * @param {string} text - SQL query
     * @param {Array} params - Query parameters
     * @returns {Promise<pg.QueryResult>}
     */
    async query(text, params) {
        const start = Date.now();
        try {
            const result = await pool.query(text, params);
            const duration = Date.now() - start;
            logger.debug({ 
                query: text.substring(0, 100), 
                duration: `${duration}ms`,
                rows: result.rowCount 
            }, 'Query executed');
            return result;
        } catch (error) {
            logger.error({ 
                error: error.message, 
                query: text.substring(0, 200) 
            }, 'Query failed');
            throw error;
        }
    },

    /**
     * Execute a query with client RLS context
     * @param {string} clientId - Client UUID
     * @param {string} text - SQL query
     * @param {Array} params - Query parameters
     * @returns {Promise<pg.QueryResult>}
     */
    async queryWithClient(clientId, text, params) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL app.current_client_id = $1`, [clientId]);
            const result = await client.query(text, params);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    /**
     * Execute multiple queries in a transaction
     * @param {Function} callback - Transaction callback receiving client
     * @returns {Promise<any>}
     */
    async transaction(callback) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    /**
     * Execute transaction with client RLS
     * @param {string} clientId - Client UUID
     * @param {Function} callback - Transaction callback
     * @returns {Promise<any>}
     */
    async transactionWithClient(clientId, callback) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL app.current_client_id = $1`, [clientId]);
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    /**
     * Get a raw client from the pool
     * @returns {Promise<pg.PoolClient>}
     */
    async getClient() {
        return pool.connect();
    },

    /**
     * End the pool
     */
    async end() {
        await pool.end();
    }
};
