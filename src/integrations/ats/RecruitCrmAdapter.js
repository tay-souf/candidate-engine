import BaseAdapter from './BaseAdapter.js';
import axios from 'axios';

/**
 * Recruit CRM ATS Adapter
 */
export default class RecruitCrmAdapter extends BaseAdapter {
  constructor(clientConfig) {
    super(clientConfig);
    this.apiKey = this.config.apiKey;
    this.baseUrl = 'https://api.recruitcrm.io/v1';
  }

  async authenticate() {
    return !!this.apiKey;
  }

  async getJobOrders(since) {
    return [];
  }

  async getCandidatesForJob(jobId) {
    return [];
  }

  async writeBackNote(candidateId, action, note) {
    return true;
  }

  async updateCandidateStatus(candidateId, status) {
    return true;
  }

  normalizeCandidateData(rawData) {
    return {
      ats_candidate_id: rawData.slug,
      first_name: rawData.first_name,
      last_name: rawData.last_name,
      email: rawData.email,
      phone: rawData.contact_number,
      status: rawData.candidate_status,
    };
  }

  normalizeJobData(rawData) {
    return {
      ats_job_id: rawData.slug,
      title: rawData.name,
      description: rawData.job_description_text,
      status: rawData.job_status,
    };
  }
}
