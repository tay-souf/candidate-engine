import BaseAdapter from './BaseAdapter.js';
import axios from 'axios';

/**
 * CEIPAL ATS Adapter
 */
export default class CeipalAdapter extends BaseAdapter {
  constructor(clientConfig) {
    super(clientConfig);
    this.apiKey = this.config.apiKey;
    this.baseUrl = 'https://api.ceipal.com/v1';
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
      ats_candidate_id: rawData.id,
      first_name: rawData.first_name,
      last_name: rawData.last_name,
      email: rawData.email_id,
      phone: rawData.mobile_no,
      status: rawData.status,
    };
  }

  normalizeJobData(rawData) {
    return {
      ats_job_id: rawData.job_code,
      title: rawData.job_title,
      description: rawData.job_description,
      status: rawData.job_status,
    };
  }
}
