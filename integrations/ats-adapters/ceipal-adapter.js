// ============================================
// CEIPAL ATS Adapter
// ============================================

import axios from 'axios';
import { BaseATSAdapter } from './base-adapter.js';

export class CeipalAdapter extends BaseATSAdapter {
    constructor(connection) {
        super(connection);
        this.baseUrl = connection.api_url || 'https://api.ceipal.com';
    }

    async authenticate() {
        const credentials = this.decryptCredentials(this.connection.credentials_encrypted);
        
        try {
            const response = await axios.post(`${this.baseUrl}/api/token`, {
                grant_type: 'password',
                username: credentials.username,
                password: credentials.password,
                api_key: credentials.api_key
            }, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            this._accessToken = response.data.access_token;
            this._tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
            
            this.logger.info('CEIPAL authentication successful');
            return this._accessToken;
        } catch (error) {
            this.logger.error({ error: error.message }, 'CEIPAL authentication failed');
            throw new Error(`CEIPAL auth failed: ${error.message}`);
        }
    }

    async _request(method, endpoint, data = null, params = {}) {
        const token = await this.getAccessToken();
        
        try {
            const response = await axios({
                method,
                url: `${this.baseUrl}/api/v1${endpoint}`,
                data,
                params,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            if (error.response?.status === 401) {
                this._accessToken = null;
                await this.authenticate();
                return this._request(method, endpoint, data, params);
            }
            throw error;
        }
    }

    async getJobOrders(filters = {}) {
        const { limit = 100, offset = 0, status = 'Active' } = filters;
        const result = await this._request('GET', '/jobs', null, {
            pageSize: limit,
            pageNumber: Math.floor(offset / limit) + 1,
            status
        });
        return (result.results || result.data || []).map(job => this.normalizeJobOrder(job));
    }

    async getJobOrder(atsJobId) {
        const result = await this._request('GET', `/jobs/${atsJobId}`);
        return this.normalizeJobOrder(result);
    }

    async getCandidates(query = {}) {
        const { skills, location, limit = 100, offset = 0 } = query;
        const params = { pageSize: limit, pageNumber: Math.floor(offset / limit) + 1 };
        if (skills) params.skills = skills;
        if (location) params.location = location;

        const result = await this._request('GET', '/candidates', null, params);
        return (result.results || result.data || []).map(c => this.normalizeCandidate(c));
    }

    async getCandidate(atsCandidateId) {
        const result = await this._request('GET', `/candidates/${atsCandidateId}`);
        return this.normalizeCandidate(result);
    }

    async updateCandidate(atsCandidateId, data) {
        return this._request('PUT', `/candidates/${atsCandidateId}`, data);
    }

    async addNote(atsCandidateId, note, action = 'System Note') {
        return this._request('POST', `/candidates/${atsCandidateId}/notes`, {
            note_text: note,
            note_type: action
        });
    }

    async updateCandidateStatus(atsCandidateId, status) {
        return this.updateCandidate(atsCandidateId, { status });
    }

    async submitCandidate(atsCandidateId, atsJobId, data = {}) {
        return this._request('POST', '/submissions', {
            candidate_id: atsCandidateId,
            job_id: atsJobId,
            ...data
        });
    }

    normalizeCandidate(raw) {
        return {
            ats_candidate_id: String(raw.candidate_id || raw.id),
            first_name: raw.first_name || '',
            last_name: raw.last_name || '',
            email: raw.email_id || raw.email || null,
            phone: raw.mobile_number || raw.phone || null,
            alt_phone: raw.home_phone || null,
            address: raw.address || null,
            city: raw.city || null,
            state: raw.state || null,
            zip_code: raw.zip_code || null,
            current_title: raw.job_title || raw.current_designation || null,
            skills: this._parseArray(raw.skills || raw.skill_set),
            certifications: this._parseArray(raw.certifications),
            experience_years: this._parseNumber(raw.total_experience || raw.years_of_experience),
            desired_pay_rate: this._parseNumber(raw.expected_pay_rate),
            availability: raw.availability || null,
            source: raw.source || null,
            raw_data: raw
        };
    }

    normalizeJobOrder(raw) {
        return {
            ats_job_id: String(raw.job_id || raw.id),
            title: raw.job_title || raw.title || '',
            description: raw.job_description || raw.description || null,
            location: [raw.city, raw.state].filter(Boolean).join(', ') || null,
            job_type: raw.employment_type || raw.job_type || null,
            pay_rate_min: this._parseNumber(raw.min_pay_rate || raw.pay_rate),
            pay_rate_max: this._parseNumber(raw.max_pay_rate || raw.bill_rate),
            skills_required: this._parseArray(raw.required_skills || raw.skills),
            openings: this._parseNumber(raw.no_of_openings) || 1,
            start_date: raw.start_date ? new Date(raw.start_date) : null,
            raw_data: raw
        };
    }
}
