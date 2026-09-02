// ============================================
// Base ATS Adapter - Abstract Interface
// All ATS adapters must extend this class
// ============================================

import { createLogger } from '../../src/lib/logger.js';
import { cache } from '../../src/lib/redis.js';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key';

export class BaseATSAdapter {
    /**
     * @param {Object} connection - ATS connection config from database
     * @param {string} connection.id - Connection ID
     * @param {string} connection.client_id - Client ID
     * @param {string} connection.platform - ATS platform name
     * @param {string} connection.api_url - Base API URL
     * @param {string} connection.auth_type - Authentication type
     * @param {Object} connection.field_mappings - Field mapping config
     */
    constructor(connection) {
        this.connection = connection;
        this.clientId = connection.client_id;
        this.apiUrl = connection.api_url;
        this.fieldMappings = connection.field_mappings || {};
        this.logger = createLogger({ 
            adapter: this.constructor.name, 
            clientId: this.clientId 
        });
        
        this._accessToken = null;
        this._tokenExpiry = null;
    }

    // ============================================
    // Authentication Methods
    // ============================================

    /**
     * Authenticate with the ATS API
     * Must be implemented by subclasses
     * @returns {Promise<string>} Access token
     */
    async authenticate() {
        throw new Error('authenticate() must be implemented by subclass');
    }

    /**
     * Get valid access token (auto-refresh if expired)
     * @returns {Promise<string>}
     */
    async getAccessToken() {
        // Check cache first
        const cachedToken = await cache.get(`ats_token:${this.connection.id}`);
        if (cachedToken) {
            return cachedToken;
        }

        // Check if current token is still valid
        if (this._accessToken && this._tokenExpiry && new Date() < this._tokenExpiry) {
            return this._accessToken;
        }

        // Authenticate and get new token
        this._accessToken = await this.authenticate();
        
        // Cache the token
        const ttl = Math.max(0, Math.floor((this._tokenExpiry - new Date()) / 1000) - 60);
        if (ttl > 0) {
            await cache.set(`ats_token:${this.connection.id}`, this._accessToken, ttl);
        }

        return this._accessToken;
    }

    /**
     * Decrypt stored credentials
     * @param {string} encrypted - Encrypted credentials string
     * @returns {Object} Decrypted credentials
     */
    decryptCredentials(encrypted) {
        try {
            const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
            return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to decrypt credentials');
            throw new Error('Failed to decrypt ATS credentials');
        }
    }

    /**
     * Encrypt credentials for storage
     * @param {Object} credentials - Plain credentials object
     * @returns {string} Encrypted string
     */
    static encryptCredentials(credentials) {
        return CryptoJS.AES.encrypt(
            JSON.stringify(credentials), 
            ENCRYPTION_KEY
        ).toString();
    }

    // ============================================
    // Job Order Methods
    // ============================================

    /**
     * Get job orders from ATS
     * @param {Object} filters - Query filters
     * @param {number} filters.limit - Max results
     * @param {number} filters.offset - Pagination offset
     * @param {string} filters.status - Job status filter
     * @param {Date} filters.modifiedSince - Only jobs modified after this date
     * @returns {Promise<Array>} Normalized job orders
     */
    async getJobOrders(filters = {}) {
        throw new Error('getJobOrders() must be implemented by subclass');
    }

    /**
     * Get a single job order by ATS ID
     * @param {string} atsJobId - Job ID in the ATS
     * @returns {Promise<Object>} Normalized job order
     */
    async getJobOrder(atsJobId) {
        throw new Error('getJobOrder() must be implemented by subclass');
    }

    // ============================================
    // Candidate Methods
    // ============================================

    /**
     * Search candidates in ATS
     * @param {Object} query - Search criteria
     * @param {string} query.skills - Skills to match
     * @param {string} query.location - Location filter
     * @param {number} query.radius - Radius in miles
     * @param {string} query.status - Candidate status
     * @param {number} query.limit - Max results
     * @param {number} query.offset - Pagination offset
     * @returns {Promise<Array>} Normalized candidates
     */
    async getCandidates(query = {}) {
        throw new Error('getCandidates() must be implemented by subclass');
    }

    /**
     * Get a single candidate by ATS ID
     * @param {string} atsCandidateId - Candidate ID in ATS
     * @returns {Promise<Object>} Normalized candidate
     */
    async getCandidate(atsCandidateId) {
        throw new Error('getCandidate() must be implemented by subclass');
    }

    /**
     * Update candidate record in ATS
     * @param {string} atsCandidateId - Candidate ID in ATS
     * @param {Object} data - Fields to update
     * @returns {Promise<Object>} Updated candidate
     */
    async updateCandidate(atsCandidateId, data) {
        throw new Error('updateCandidate() must be implemented by subclass');
    }

    /**
     * Add a note to candidate record
     * @param {string} atsCandidateId - Candidate ID in ATS
     * @param {string} note - Note text
     * @param {string} action - Action type (e.g., 'SMS Sent', 'Call Completed')
     * @returns {Promise<Object>}
     */
    async addNote(atsCandidateId, note, action = 'System Note') {
        throw new Error('addNote() must be implemented by subclass');
    }

    /**
     * Update candidate status in ATS
     * @param {string} atsCandidateId 
     * @param {string} status 
     * @returns {Promise<Object>}
     */
    async updateCandidateStatus(atsCandidateId, status) {
        throw new Error('updateCandidateStatus() must be implemented by subclass');
    }

    // ============================================
    // Placement / Submission Methods
    // ============================================

    /**
     * Submit candidate for a job
     * @param {string} atsCandidateId 
     * @param {string} atsJobId 
     * @param {Object} data - Submission data
     * @returns {Promise<Object>}
     */
    async submitCandidate(atsCandidateId, atsJobId, data = {}) {
        throw new Error('submitCandidate() must be implemented by subclass');
    }

    // ============================================
    // Data Normalization
    // ============================================

    /**
     * Normalize raw ATS candidate data to standard format
     * @param {Object} rawCandidate - Raw candidate data from ATS
     * @returns {Object} Normalized candidate
     */
    normalizeCandidate(rawCandidate) {
        const mappings = this.fieldMappings;
        
        return {
            ats_candidate_id: this._getField(rawCandidate, mappings.id || 'id'),
            first_name: this._getField(rawCandidate, mappings.first_name || 'firstName'),
            last_name: this._getField(rawCandidate, mappings.last_name || 'lastName'),
            email: this._getField(rawCandidate, mappings.email || 'email'),
            phone: this._getField(rawCandidate, mappings.phone || 'phone'),
            alt_phone: this._getField(rawCandidate, mappings.alt_phone || 'phone2'),
            address: this._getField(rawCandidate, mappings.address || 'address'),
            city: this._getField(rawCandidate, mappings.city || 'city'),
            state: this._getField(rawCandidate, mappings.state || 'state'),
            zip_code: this._getField(rawCandidate, mappings.zip_code || 'zip'),
            current_title: this._getField(rawCandidate, mappings.title || 'occupation'),
            skills: this._parseArray(this._getField(rawCandidate, mappings.skills || 'skills')),
            certifications: this._parseArray(this._getField(rawCandidate, mappings.certifications || 'certifications')),
            experience_years: this._parseNumber(this._getField(rawCandidate, mappings.experience || 'experience')),
            desired_pay_rate: this._parseNumber(this._getField(rawCandidate, mappings.pay_rate || 'desiredPay')),
            availability: this._getField(rawCandidate, mappings.availability || 'availability'),
            source: this._getField(rawCandidate, mappings.source || 'source'),
            raw_data: rawCandidate
        };
    }

    /**
     * Normalize raw ATS job order data to standard format
     * @param {Object} rawJob - Raw job data from ATS
     * @returns {Object} Normalized job order
     */
    normalizeJobOrder(rawJob) {
        const mappings = this.fieldMappings;
        
        return {
            ats_job_id: this._getField(rawJob, mappings.job_id || 'id'),
            title: this._getField(rawJob, mappings.job_title || 'title'),
            description: this._getField(rawJob, mappings.job_description || 'description'),
            location: this._getField(rawJob, mappings.job_location || 'location'),
            job_type: this._getField(rawJob, mappings.job_type || 'employmentType'),
            pay_rate_min: this._parseNumber(this._getField(rawJob, mappings.pay_min || 'payRate')),
            pay_rate_max: this._parseNumber(this._getField(rawJob, mappings.pay_max || 'maxPayRate')),
            skills_required: this._parseArray(this._getField(rawJob, mappings.required_skills || 'skills')),
            openings: this._parseNumber(this._getField(rawJob, mappings.openings || 'numOpenings')) || 1,
            start_date: this._getField(rawJob, mappings.start_date || 'startDate'),
            raw_data: rawJob
        };
    }

    // ============================================
    // Field Mapping Helpers
    // ============================================

    /**
     * Get nested field value using dot notation
     * @param {Object} obj - Source object
     * @param {string} path - Dot-notation path (e.g., 'address.city')
     * @returns {any}
     */
    _getField(obj, path) {
        if (!path || !obj) return null;
        
        // Support comma-separated fields (concatenation)
        if (path.includes(',')) {
            return path.split(',').map(p => this._getField(obj, p.trim())).filter(Boolean).join(' ');
        }
        
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);
    }

    /**
     * Parse value as array
     * @param {any} value 
     * @returns {Array}
     */
    _parseArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            // Handle comma-separated, semicolon-separated, or newline-separated
            return value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
        }
        return [value];
    }

    /**
     * Parse value as number
     * @param {any} value 
     * @returns {number|null}
     */
    _parseNumber(value) {
        if (value === null || value === undefined) return null;
        const num = Number(value);
        return isNaN(num) ? null : num;
    }

    // ============================================
    // API Helper Methods
    // ============================================

    /**
     * Get the platform name
     * @returns {string}
     */
    getPlatform() {
        return this.connection.platform;
    }

    /**
     * Get field mappings configuration
     * @returns {Object}
     */
    getFieldMappings() {
        return this.fieldMappings;
    }

    /**
     * Test connection to ATS
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this.authenticate();
            return true;
        } catch (error) {
            this.logger.error({ error: error.message }, 'ATS connection test failed');
            return false;
        }
    }
}
