// ============================================
// Bullhorn ATS Adapter
// REST API Integration
// ============================================

import axios from 'axios';
import { BaseATSAdapter } from './base-adapter.js';

export class BullhornAdapter extends BaseATSAdapter {
    constructor(connection) {
        super(connection);
        this.authUrl = 'https://auth.bullhornstaffing.com/oauth';
        this.restUrl = null; // Set after authentication
        this.BhRestToken = null;
    }

    // ============================================
    // Authentication (OAuth2)
    // ============================================
    async authenticate() {
        const credentials = this.decryptCredentials(this.connection.credentials_encrypted);
        
        try {
            // Step 1: Get authorization code
            const authResponse = await axios.post(`${this.authUrl}/authorize`, null, {
                params: {
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret,
                    grant_type: 'client_credentials',
                    response_type: 'code'
                }
            });

            // Step 2: Exchange for access token
            const tokenResponse = await axios.post(`${this.authUrl}/token`, null, {
                params: {
                    grant_type: 'authorization_code',
                    code: authResponse.data.code || authResponse.data.access_token,
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret
                }
            });

            const { access_token, refresh_token, expires_in } = tokenResponse.data;
            this._tokenExpiry = new Date(Date.now() + (expires_in * 1000));

            // Step 3: Login to get REST URL and BhRestToken
            const loginResponse = await axios.post(
                'https://rest.bullhornstaffing.com/rest-services/login',
                null,
                {
                    params: {
                        version: '*',
                        access_token
                    }
                }
            );

            this.restUrl = loginResponse.data.restUrl;
            this.BhRestToken = loginResponse.data.BhRestToken;
            this._accessToken = access_token;

            this.logger.info('Bullhorn authentication successful');
            return access_token;
        } catch (error) {
            this.logger.error({ error: error.message }, 'Bullhorn authentication failed');
            throw new Error(`Bullhorn auth failed: ${error.message}`);
        }
    }

    /**
     * Make authenticated API request to Bullhorn
     */
    async _request(method, endpoint, data = null, params = {}) {
        if (!this.BhRestToken) {
            await this.getAccessToken();
        }

        try {
            const response = await axios({
                method,
                url: `${this.restUrl}${endpoint}`,
                data,
                params: {
                    ...params,
                    BhRestToken: this.BhRestToken
                },
                headers: { 'Content-Type': 'application/json' }
            });
            return response.data;
        } catch (error) {
            if (error.response?.status === 401) {
                // Token expired, re-authenticate
                this.logger.warn('Bullhorn token expired, re-authenticating...');
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
        
        let where = `status='${status}'`;
        if (modifiedSince) {
            const timestamp = new Date(modifiedSince).getTime();
            where += ` AND dateLastModified>${timestamp}`;
        }

        const result = await this._request('GET', '/search/JobOrder', null, {
            query: where,
            fields: 'id,title,description,address,employmentType,payRate,salary,numOpenings,skills,startDate,dateEnd,status,clientContact,owner,dateLastModified',
            count: limit,
            start: offset,
            sort: '-dateLastModified'
        });

        return (result.data || []).map(job => this.normalizeJobOrder(job));
    }

    async getJobOrder(atsJobId) {
        const result = await this._request('GET', `/entity/JobOrder/${atsJobId}`, null, {
            fields: 'id,title,description,address,employmentType,payRate,salary,numOpenings,skills,startDate,dateEnd,status,clientContact,owner'
        });
        return this.normalizeJobOrder(result.data);
    }

    // ============================================
    // Candidates
    // ============================================
    async getCandidates(query = {}) {
        const { skills, location, status, limit = 100, offset = 0 } = query;
        
        let where = 'isDeleted=false';
        if (status) where += ` AND status='${status}'`;
        if (skills) where += ` AND skillSet LIKE '%${skills}%'`;
        if (location) where += ` AND address.city='${location}'`;

        const result = await this._request('GET', '/search/Candidate', null, {
            query: where,
            fields: 'id,firstName,lastName,email,phone,phone2,address,occupation,skillSet,certifications,experience,desiredPay,status,source,dateLastModified',
            count: limit,
            start: offset,
            sort: '-dateLastModified'
        });

        return (result.data || []).map(candidate => this.normalizeCandidate(candidate));
    }

    async getCandidate(atsCandidateId) {
        const result = await this._request('GET', `/entity/Candidate/${atsCandidateId}`, null, {
            fields: 'id,firstName,lastName,email,phone,phone2,address,occupation,skillSet,certifications,experience,desiredPay,status,source,dateAdded'
        });
        return this.normalizeCandidate(result.data);
    }

    async updateCandidate(atsCandidateId, data) {
        const result = await this._request('POST', `/entity/Candidate/${atsCandidateId}`, data);
        this.logger.info({ candidateId: atsCandidateId }, 'Bullhorn candidate updated');
        return result;
    }

    async addNote(atsCandidateId, note, action = 'System Note') {
        const noteData = {
            personReference: { id: atsCandidateId },
            action,
            comments: note,
            isDeleted: false
        };
        const result = await this._request('PUT', '/entity/Note', noteData);
        this.logger.info({ candidateId: atsCandidateId }, 'Note added to Bullhorn candidate');
        return result;
    }

    async updateCandidateStatus(atsCandidateId, status) {
        return this.updateCandidate(atsCandidateId, { status });
    }

    async submitCandidate(atsCandidateId, atsJobId, data = {}) {
        const submissionData = {
            candidate: { id: atsCandidateId },
            jobOrder: { id: atsJobId },
            status: 'Submitted',
            ...data
        };
        const result = await this._request('PUT', '/entity/JobSubmission', submissionData);
        this.logger.info({ candidateId: atsCandidateId, jobId: atsJobId }, 'Candidate submitted in Bullhorn');
        return result;
    }

    // ============================================
    // Bullhorn-specific normalization overrides
    // ============================================
    normalizeCandidate(rawCandidate) {
        return {
            ats_candidate_id: String(rawCandidate.id),
            first_name: rawCandidate.firstName || '',
            last_name: rawCandidate.lastName || '',
            email: rawCandidate.email || null,
            phone: rawCandidate.phone || null,
            alt_phone: rawCandidate.phone2 || null,
            address: rawCandidate.address?.address1 || null,
            city: rawCandidate.address?.city || null,
            state: rawCandidate.address?.state || null,
            zip_code: rawCandidate.address?.zip || null,
            current_title: rawCandidate.occupation || null,
            skills: this._parseSkillSet(rawCandidate.skillSet),
            certifications: this._parseArray(rawCandidate.certifications),
            experience_years: this._parseNumber(rawCandidate.experience),
            desired_pay_rate: this._parseNumber(rawCandidate.desiredPay),
            availability: null,
            source: rawCandidate.source || null,
            raw_data: rawCandidate
        };
    }

    normalizeJobOrder(rawJob) {
        return {
            ats_job_id: String(rawJob.id),
            title: rawJob.title || '',
            description: rawJob.description || null,
            location: rawJob.address 
                ? `${rawJob.address.city || ''}, ${rawJob.address.state || ''}`.trim()
                : null,
            job_type: rawJob.employmentType || null,
            pay_rate_min: this._parseNumber(rawJob.payRate),
            pay_rate_max: this._parseNumber(rawJob.salary),
            skills_required: this._parseSkillSet(rawJob.skills?.data?.map(s => s.name)?.join(', ')),
            openings: this._parseNumber(rawJob.numOpenings) || 1,
            start_date: rawJob.startDate ? new Date(rawJob.startDate) : null,
            raw_data: rawJob
        };
    }

    _parseSkillSet(skillSet) {
        if (!skillSet) return [];
        if (typeof skillSet === 'string') {
            return skillSet.split(',').map(s => s.trim()).filter(Boolean);
        }
        return this._parseArray(skillSet);
    }
}
