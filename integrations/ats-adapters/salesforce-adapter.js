// ============================================
// Salesforce Adapter (CRM/ATS)
// ============================================

import axios from 'axios';
import { BaseATSAdapter } from './base-adapter.js';

export class SalesforceAdapter extends BaseATSAdapter {
    constructor(connection) {
        super(connection);
        this.instanceUrl = null;
        this.apiVersion = 'v59.0';
    }

    async authenticate() {
        const credentials = this.decryptCredentials(this.connection.credentials_encrypted);
        const loginUrl = credentials.is_sandbox 
            ? 'https://test.salesforce.com' 
            : 'https://login.salesforce.com';
        
        try {
            const response = await axios.post(`${loginUrl}/services/oauth2/token`, null, {
                params: {
                    grant_type: 'client_credentials',
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret
                },
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            this._accessToken = response.data.access_token;
            this.instanceUrl = response.data.instance_url;
            this._tokenExpiry = new Date(Date.now() + 7200000); // 2 hours
            
            this.logger.info({ instanceUrl: this.instanceUrl }, 'Salesforce authentication successful');
            return this._accessToken;
        } catch (error) {
            this.logger.error({ error: error.message }, 'Salesforce authentication failed');
            throw new Error(`Salesforce auth failed: ${error.message}`);
        }
    }

    async _request(method, endpoint, data = null, params = {}) {
        const token = await this.getAccessToken();
        
        try {
            const response = await axios({
                method,
                url: `${this.instanceUrl}/services/data/${this.apiVersion}${endpoint}`,
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

    async _soqlQuery(query) {
        const result = await this._request('GET', '/query', null, { q: query });
        return result.records || [];
    }

    // ============================================
    // Job Orders (using custom or standard objects)
    // ============================================
    async getJobOrders(filters = {}) {
        const { limit = 100, offset = 0, status = 'Open' } = filters;
        
        // Using custom Job_Order__c or standard object
        const objectName = this.fieldMappings.job_object || 'Job_Order__c';
        const query = `SELECT Id, Name, Description__c, Location__c, 
                       Employment_Type__c, Pay_Rate__c, Max_Pay_Rate__c, 
                       Openings__c, Skills__c, Start_Date__c, Status__c,
                       LastModifiedDate
                       FROM ${objectName} 
                       WHERE Status__c = '${status}'
                       ORDER BY LastModifiedDate DESC 
                       LIMIT ${limit} OFFSET ${offset}`;
        
        const records = await this._soqlQuery(query);
        return records.map(job => this.normalizeJobOrder(job));
    }

    async getJobOrder(atsJobId) {
        const objectName = this.fieldMappings.job_object || 'Job_Order__c';
        const records = await this._soqlQuery(
            `SELECT Id, Name, Description__c, Location__c, Employment_Type__c, 
             Pay_Rate__c, Max_Pay_Rate__c, Openings__c, Skills__c, Start_Date__c 
             FROM ${objectName} WHERE Id = '${atsJobId}'`
        );
        return records.length > 0 ? this.normalizeJobOrder(records[0]) : null;
    }

    // ============================================
    // Candidates (Contact or custom object)
    // ============================================
    async getCandidates(query = {}) {
        const { skills, location, limit = 100, offset = 0 } = query;
        const objectName = this.fieldMappings.candidate_object || 'Contact';
        
        let whereClause = `RecordType.Name = 'Candidate'`;
        if (skills) whereClause += ` AND Skills__c LIKE '%${skills}%'`;
        if (location) whereClause += ` AND MailingCity = '${location}'`;

        const soql = `SELECT Id, FirstName, LastName, Email, Phone, MobilePhone,
                      MailingStreet, MailingCity, MailingState, MailingPostalCode,
                      Title, Skills__c, Certifications__c, Experience_Years__c,
                      Desired_Pay_Rate__c, Availability__c, LeadSource,
                      LastModifiedDate
                      FROM ${objectName}
                      WHERE ${whereClause}
                      ORDER BY LastModifiedDate DESC
                      LIMIT ${limit} OFFSET ${offset}`;
        
        const records = await this._soqlQuery(soql);
        return records.map(c => this.normalizeCandidate(c));
    }

    async getCandidate(atsCandidateId) {
        const objectName = this.fieldMappings.candidate_object || 'Contact';
        const records = await this._soqlQuery(
            `SELECT Id, FirstName, LastName, Email, Phone, MobilePhone,
             MailingStreet, MailingCity, MailingState, MailingPostalCode,
             Title, Skills__c, Certifications__c, Experience_Years__c,
             Desired_Pay_Rate__c, Availability__c, LeadSource
             FROM ${objectName} WHERE Id = '${atsCandidateId}'`
        );
        return records.length > 0 ? this.normalizeCandidate(records[0]) : null;
    }

    async updateCandidate(atsCandidateId, data) {
        const objectName = this.fieldMappings.candidate_object || 'Contact';
        return this._request('PATCH', `/sobjects/${objectName}/${atsCandidateId}`, data);
    }

    async addNote(atsCandidateId, note, action = 'System Note') {
        return this._request('POST', '/sobjects/Note', {
            ParentId: atsCandidateId,
            Title: `[Stratton Engine] ${action}`,
            Body: note
        });
    }

    async updateCandidateStatus(atsCandidateId, status) {
        return this.updateCandidate(atsCandidateId, { Status__c: status });
    }

    async submitCandidate(atsCandidateId, atsJobId, data = {}) {
        const objectName = this.fieldMappings.submission_object || 'Job_Submission__c';
        return this._request('POST', `/sobjects/${objectName}`, {
            Candidate__c: atsCandidateId,
            Job_Order__c: atsJobId,
            Status__c: 'Submitted',
            ...data
        });
    }

    normalizeCandidate(raw) {
        return {
            ats_candidate_id: raw.Id,
            first_name: raw.FirstName || '',
            last_name: raw.LastName || '',
            email: raw.Email || null,
            phone: raw.MobilePhone || raw.Phone || null,
            alt_phone: raw.Phone || null,
            address: raw.MailingStreet || null,
            city: raw.MailingCity || null,
            state: raw.MailingState || null,
            zip_code: raw.MailingPostalCode || null,
            current_title: raw.Title || null,
            skills: this._parseArray(raw.Skills__c),
            certifications: this._parseArray(raw.Certifications__c),
            experience_years: this._parseNumber(raw.Experience_Years__c),
            desired_pay_rate: this._parseNumber(raw.Desired_Pay_Rate__c),
            availability: raw.Availability__c || null,
            source: raw.LeadSource || null,
            raw_data: raw
        };
    }

    normalizeJobOrder(raw) {
        return {
            ats_job_id: raw.Id,
            title: raw.Name || '',
            description: raw.Description__c || null,
            location: raw.Location__c || null,
            job_type: raw.Employment_Type__c || null,
            pay_rate_min: this._parseNumber(raw.Pay_Rate__c),
            pay_rate_max: this._parseNumber(raw.Max_Pay_Rate__c),
            skills_required: this._parseArray(raw.Skills__c),
            openings: this._parseNumber(raw.Openings__c) || 1,
            start_date: raw.Start_Date__c ? new Date(raw.Start_Date__c) : null,
            raw_data: raw
        };
    }
}
