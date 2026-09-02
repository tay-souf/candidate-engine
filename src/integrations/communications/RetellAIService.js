import Retell from 'retell-sdk';
import logger from '../../services/LoggerService.js';
import DedupService from '../../services/DedupService.js';

export default class RetellAIService {
  constructor() {
    this.client = new Retell({
      apiKey: process.env.RETELL_API_KEY,
    });
    this.dedupService = new DedupService();
  }

  /**
   * Initiate an outbound AI call to a candidate
   * @param {string} candidateId - Candidate ID
   * @param {string} to - Recipient phone number
   * @param {string} from - Our Twilio/Retell mapped phone number
   * @param {string} agentId - The Retell Agent ID for this specific campaign
   * @param {Object} dynamicVariables - Variables to inject into the prompt (e.g. name, jobTitle)
   */
  async createOutboundCall(candidateId, to, from, agentId, dynamicVariables) {
    const actionKey = `call_${agentId}`;
    
    if (await this.dedupService.hasActionBeenTaken(candidateId, actionKey)) {
      logger.warn(`Duplicate outbound call prevented for candidate ${candidateId}`);
      return false;
    }

    try {
      const call = await this.client.call.createPhoneCall({
        from_number: from,
        to_number: to,
        override_agent_id: agentId,
        retell_llm_dynamic_variables: dynamicVariables,
      });

      logger.info(`Outbound AI call initiated to ${to} (Call ID: ${call.call_id})`);
      await this.dedupService.markActionTaken(candidateId, actionKey);
      
      return call;
    } catch (error) {
      logger.error(`Failed to initiate AI call to ${to}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch details/recording/transcript of a completed call
   * @param {string} callId 
   */
  async getCallDetails(callId) {
    try {
      const callInfo = await this.client.call.retrieve(callId);
      return callInfo;
    } catch (error) {
      logger.error(`Failed to retrieve call ${callId}: ${error.message}`);
      throw error;
    }
  }
}
