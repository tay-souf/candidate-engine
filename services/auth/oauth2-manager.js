// ============================================
// OAuth2 Manager - Token lifecycle management
// ============================================

import { db } from '../../src/lib/database.js';
import { createLogger } from '../../src/lib/logger.js';
import CryptoJS from 'crypto-js';

const logger = createLogger({ module: 'OAuth2Manager' });
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key';

export class OAuth2Manager {

    /**
     * Store OAuth2 tokens securely
     * @param {string} connectionId - ATS connection ID
     * @param {Object} tokens - Token data
     */
    static async storeTokens(connectionId, tokens) {
        const { access_token, refresh_token, expires_in } = tokens;
        const expiresAt = new Date(Date.now() + (expires_in * 1000));

        await db.query(`
            UPDATE ats_connections SET
                oauth_access_token = $1,
                oauth_refresh_token = $2,
                token_expires_at = $3,
                updated_at = NOW()
            WHERE id = $4
        `, [
            CryptoJS.AES.encrypt(access_token, ENCRYPTION_KEY).toString(),
            refresh_token ? CryptoJS.AES.encrypt(refresh_token, ENCRYPTION_KEY).toString() : null,
            expiresAt,
            connectionId
        ]);

        logger.info({ connectionId, expiresAt }, 'OAuth2 tokens stored');
    }

    /**
     * Retrieve and decrypt tokens
     * @param {string} connectionId 
     * @returns {Promise<Object>}
     */
    static async getTokens(connectionId) {
        const result = await db.query(
            `SELECT oauth_access_token, oauth_refresh_token, token_expires_at FROM ats_connections WHERE id = $1`,
            [connectionId]
        );

        if (result.rows.length === 0) return null;
        const row = result.rows[0];

        return {
            access_token: row.oauth_access_token 
                ? CryptoJS.AES.decrypt(row.oauth_access_token, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
                : null,
            refresh_token: row.oauth_refresh_token
                ? CryptoJS.AES.decrypt(row.oauth_refresh_token, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
                : null,
            expires_at: row.token_expires_at
        };
    }

    /**
     * Check if token is expired or about to expire
     * @param {string} connectionId 
     * @param {number} bufferSeconds - Check if expires within this window
     * @returns {Promise<boolean>}
     */
    static async isTokenExpired(connectionId, bufferSeconds = 300) {
        const result = await db.query(
            `SELECT token_expires_at FROM ats_connections WHERE id = $1`,
            [connectionId]
        );

        if (result.rows.length === 0) return true;
        const expiresAt = new Date(result.rows[0].token_expires_at);
        return expiresAt <= new Date(Date.now() + bufferSeconds * 1000);
    }

    /**
     * Store encrypted credentials
     * @param {string} connectionId 
     * @param {Object} credentials 
     */
    static async storeCredentials(connectionId, credentials) {
        const encrypted = CryptoJS.AES.encrypt(
            JSON.stringify(credentials),
            ENCRYPTION_KEY
        ).toString();

        await db.query(
            `UPDATE ats_connections SET credentials_encrypted = $1, updated_at = NOW() WHERE id = $2`,
            [encrypted, connectionId]
        );

        logger.info({ connectionId }, 'Credentials stored securely');
    }
}
