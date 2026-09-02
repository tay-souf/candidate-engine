// ============================================
// Recruit CRM Adapter
// ============================================

import axios from 'axios';
import { BaseATSAdapter } from './base-adapter.js';

export class RecruitCRMAdapter extends BaseATSAdapter {
    constructor(connection) {
        super(connection);
        this.baseUrl = connection.api_url || 'https://api.recruitcrm.io/v1';
    }

    async authenticate() {
        const credentials = this.decryptCredentials(this.connection.credentials_encrypted);
        this._accessToken = credentials.api_key;
        this._tokenExpiry = new Date(Date.now() + 86400000); // API key doesn't expire
        this.logger.info('Recruit CRM authentication successful');
        return this._accessToken;
    }

    async _request(method, endpoint, data = null, params = {}) {
        const token = await this.getAccessToken();
        
        const response = await axios({
            method,
            url: `${this.baseUrl}${endpoint}`,
            data,
            params,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        return response.data;
    }

    async getJobOrders(filters = {}) {
        const { limit = 100, offset = 0 } = filters;
        const result = await this._request('GET', '/jobs', null, {
            limit,
            offset,
            sort_by: 'updated_on',
            sort_order: 'desc'
        });
        return (result.data || []).map(job => this.normalizeJobOrder(job));
    }

    async getJobOrder(atsJobId) {
        const result = await this._request('GET', `/jobs/${atsJobId}`);
        return this.normalizeJobOrder(result);
    }

    async getCandidates(query = {}) {
        const { limit = 100, offset = 0 } = query;
        const result = await this._request('GET', '/candidates', null, {
            limit,
            offset,
            sort_by: 'updated_on',
            sort_order: 'desc'
        });
        return (result.data || []).map(c => this.normalizeCandidate(c));
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
            note,
            type: action
        });
    }

    async updateCandidateStatus(atsCandidateId, status) {
        return this.updateCandidate(atsCandidateId, { candidate_status: status });
    }

    async submitCandidate(atsCandidateId, atsJobId, data = {}) {
        return this._request('POST', `/jobs/${atsJobId}/candidates`, {
            candidate_slug: atsCandidateId,
            ...data
        });
    }

    normalizeCandidate(raw) {
        return {
            ats_candidate_id: String(raw.slug || raw.id),
            first_name: raw.first_name || '',
            last_name: raw.last_name || '',
            email: raw.email || null,
            phone: raw.phone || raw.mobile || null,
            alt_phone: raw.work_phone || null,
            address: raw.address || null,
            city: raw.city || null,
            state: raw.state || null,
            zip_code: raw.zip || null,
            current_title: raw.position || raw.current_position || null,
            skills: this._parseArray(raw.skills),
            certifications: this._parseArray(raw.certifications),
            experience_years: this._parseNumber(raw.experience_in_years),
            desired_pay_rate: this._parseNumber(raw.desired_salary),
            availability: raw.availability_status || null,
            source: raw.source || null,
            raw_data: raw
        };
    }

    normalizeJobOrder(raw) {
        return {
            ats_job_id: String(raw.slug || raw.id),
            title: raw.name || raw.title || '',
            description: raw.description || null,
            location: raw.city ? `${raw.city}, ${raw.state || ''}`.trim() : null,
            job_type: raw.job_type || null,
            pay_rate_min: this._parseNumber(raw.minimum_salary),
            pay_rate_max: this._parseNumber(raw.maximum_salary),
            skills_required: this._parseArray(raw.skills),
            openings: this._parseNumber(raw.number_of_positions) || 1,
            start_date: raw.start_date ? new Date(raw.start_date) : null,
            raw_data: raw
        };
    }
}
