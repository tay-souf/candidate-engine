/**
 * Base ATS Adapter
 * 
 * This is the abstract class that all specific ATS adapters (Bullhorn, Avionte, etc.)
 * must extend. It enforces a standard interface for the Candidate Engine.
 */
export default class BaseAdapter {
  constructor(clientConfig) {
    this.config = clientConfig;
    if (new.target === BaseAdapter) {
      throw new TypeError("Cannot construct BaseAdapter instances directly");
    }
  }

  /**
   * Authenticates with the ATS API and retrieves necessary tokens.
   * @returns {Promise<boolean>} True if authentication is successful.
   */
  async authenticate() {
    throw new Error("Method 'authenticate()' must be implemented.");
  }

  /**
   * Fetches new or updated job orders from the ATS.
   * @param {Date} since - Fetch jobs updated since this date.
   * @returns {Promise<Array>} Array of standardized Job Order objects.
   */
  async getJobOrders(since) {
    throw new Error("Method 'getJobOrders()' must be implemented.");
  }

  /**
   * Fetches candidates that match a specific job order criteria.
   * @param {string} jobId - The ID of the job order in the ATS.
   * @returns {Promise<Array>} Array of standardized Candidate objects.
   */
  async getCandidatesForJob(jobId) {
    throw new Error("Method 'getCandidatesForJob()' must be implemented.");
  }

  /**
   * Writes a note or activity back to the candidate's profile in the ATS.
   * @param {string} candidateId - The ID of the candidate in the ATS.
   * @param {string} action - The action type (e.g., 'SMS Sent', 'Call Completed').
   * @param {string} note - The content of the note.
   * @returns {Promise<boolean>} True if write-back is successful.
   */
  async writeBackNote(candidateId, action, note) {
    throw new Error("Method 'writeBackNote()' must be implemented.");
  }

  /**
   * Updates a candidate's status in the ATS (e.g., 'Interested', 'Interviewing').
   * @param {string} candidateId - The ID of the candidate in the ATS.
   * @param {string} status - The new status.
   * @returns {Promise<boolean>} True if update is successful.
   */
  async updateCandidateStatus(candidateId, status) {
    throw new Error("Method 'updateCandidateStatus()' must be implemented.");
  }

  /**
   * Normalizes raw ATS candidate data into the standard Candidate Engine format.
   * @param {Object} rawData - The raw data from the ATS.
   * @returns {Object} Standardized Candidate Object.
   */
  normalizeCandidateData(rawData) {
    throw new Error("Method 'normalizeCandidateData()' must be implemented.");
  }

  /**
   * Normalizes raw ATS job data into the standard Candidate Engine format.
   * @param {Object} rawData - The raw data from the ATS.
   * @returns {Object} Standardized Job Order Object.
   */
  normalizeJobData(rawData) {
    throw new Error("Method 'normalizeJobData()' must be implemented.");
  }
}
