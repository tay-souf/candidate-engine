// ============================================
// Avionté ATS Adapter
// REST API Integration
// ============================================

import axios from 'axios';
import { BaseATSAdapter } from './base-adapter.js';

export class AvionteAdapter extends BaseATSAdapter {
    constructor(connection) {
        super(connection);
        this.baseUrl = connection.api_url || 'https://api.avionte.com';
    }

    async authenticate() {
        const credentials = this.decryptCredentials(this.connection.credentials_encrypted);
        
        try {
            const response = await axios.post(`${this.baseUrl}/oauth/token`, {
                grant_type: 'client_credentials',
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                scope: 'api'
            });

            const { access_token, expires_in } = response.data;
            this._accessToken = access_token;
            this._tokenExpiry = new Date(Date.now() + (expires_in * 1000));
            
            this.logger.info('Avionté authentication successful');
            return access_token;
        } catch (error) {
            this.logger.error({ error: error.message }, 'Avionté authentication failed');
            throw new Error(`Avionté auth failed: ${error.message}`);
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
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
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

    // ============================================
    // Job Orders
    // ============================================
    async getJobOrders(filters = {}) {
        const { limit = 100, offset = 0, status = 'Open', modifiedSince } = filters;
        
        const params = {
            $top: limit,
            $skip: offset,
            $filter: `Status eq '${status}'`,
            $orderby: 'ModifiedDate desc'
        };
        
        if (modifiedSince) {
            params.$filter += ` and ModifiedDate gt ${new Date(modifiedSince).toISOString()}`;
        }

        const result = await this._request('GET', '/joborders', null, params);
        return (result.value || result.data || []).map(job => this.normalizeJobOrder(job));
    }

    async getJobOrder(atsJobId) {
        const result = await this._request('GET', `/joborders/${atsJobId}`);
        return this.normalizeJobOrder(result);
    }

    // ============================================
    // Candidates
    // ============================================
    async getCandidates(query = {}) {
        const { skills, location, limit = 100, offset = 0 } = query;
        
        const params = {
            $top: limit,
            $skip: offset,
            $orderby: 'ModifiedDate desc'
        };

        let filter = '';
        if (skills) filter += `contains(Skills, '${skills}')`;
        if (location) {
            if (filter) filter += ' and ';
            filter += `City eq '${location}'`;
        }
        if (filter) params.$filter = filter;

        const result = await this._request('GET', '/candidates', null, params);
        return (result.value || result.data || []).map(c => this.normalizeCandidate(c));
    }

    async getCandidate(atsCandidateId) {
        const result = await this._request('GET', `/candidates/${atsCandidateId}`);
        return this.normalizeCandidate(result);
    }

    async updateCandidate(atsCandidateId, data) {
        return this._request('PATCH', `/candidates/${atsCandidateId}`, data);
    }

    async addNote(atsCandidateId, note, action = 'System Note') {
        return this._request('POST', `/candidates/${atsCandidateId}/notes`, {
            NoteText: note,
            NoteType: action,
            CreatedDate: new Date().toISOString()
        });
    }

    async updateCandidateStatus(atsCandidateId, status) {
        return this.updateCandidate(atsCandidateId, { Status: status });
    }

    async submitCandidate(atsCandidateId, atsJobId, data = {}) {
        return this._request('POST', '/submissions', {
            CandidateId: atsCandidateId,
            JobOrderId: atsJobId,
            Status: 'Submitted',
            ...data
        });
    }

    // ============================================
    // Normalization
    // ============================================
    normalizeCandidate(raw) {
        return {
            ats_candidate_id: String(raw.CandidateId || raw.Id),
            first_name: raw.FirstName || '',
            last_name: raw.LastName || '',
            email: raw.Email || raw.PrimaryEmail || null,
            phone: raw.Phone || raw.CellPhone || raw.MobilePhone || null,
            alt_phone: raw.HomePhone || raw.WorkPhone || null,
            address: raw.Address || raw.StreetAddress || null,
            city: raw.City || null,
            state: raw.State || null,
            zip_code: raw.ZipCode || raw.PostalCode || null,
            current_title: raw.JobTitle || raw.CurrentTitle || null,
            skills: this._parseArray(raw.Skills),
            certifications: this._parseArray(raw.Certifications || raw.Licenses),
            experience_years: this._parseNumber(raw.YearsOfExperience),
            desired_pay_rate: this._parseNumber(raw.DesiredPayRate || raw.DesiredSalary),
            availability: raw.Availability || null,
            source: raw.Source || null,
            raw_data: raw
        };
    }

    normalizeJobOrder(raw) {
        return {
            ats_job_id: String(raw.JobOrderId || raw.Id),
            title: raw.JobTitle || raw.Title || '',
            description: raw.Description || raw.JobDescription || null,
            location: [raw.City, raw.State].filter(Boolean).join(', ') || null,
            job_type: raw.EmploymentType || raw.JobType || null,
            pay_rate_min: this._parseNumber(raw.PayRateMin || raw.PayRate),
            pay_rate_max: this._parseNumber(raw.PayRateMax || raw.BillRate),
            skills_required: this._parseArray(raw.RequiredSkills || raw.Skills),
            openings: this._parseNumber(raw.NumberOfOpenings) || 1,
            start_date: raw.StartDate ? new Date(raw.StartDate) : null,
            raw_data: raw
        };
    }
}
