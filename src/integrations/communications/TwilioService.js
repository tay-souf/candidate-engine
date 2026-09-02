import twilio from 'twilio';
import logger from '../../services/LoggerService.js';
import DedupService from '../../services/DedupService.js';

export default class TwilioService {
  constructor() {
    this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    this.dedupService = new DedupService();
  }

  /**
   * Send an SMS to a candidate
   * @param {string} candidateId - Candidate ID for deduplication
   * @param {string} to - Recipient phone number
   * @param {string} message - Message body
   */
  async sendSMS(candidateId, to, message) {
    const actionKey = `sms_${message.substring(0, 10)}`;
    
    // Prevent sending the exact same initial SMS multiple times
    if (await this.dedupService.hasActionBeenTaken(candidateId, actionKey)) {
      logger.warn(`Duplicate SMS prevented for candidate ${candidateId}`);
      return false;
    }

    try {
      const response = await this.client.messages.create({
        body: message,
        from: this.phoneNumber,
        to: to
      });
      
      logger.info(`SMS sent successfully to ${to} (SID: ${response.sid})`);
      await this.dedupService.markActionTaken(candidateId, actionKey);
      
      return response;
    } catch (error) {
      logger.error(`Failed to send SMS to ${to}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Webhook handler for incoming SMS (e.g., Opt-outs, Replies)
   */
  handleIncomingMessage(req, res) {
    const { From, Body } = req.body;
    logger.info(`Received SMS from ${From}: ${Body}`);
    
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const isOptOut = optOutKeywords.some(keyword => Body.toUpperCase().includes(keyword));

    if (isOptOut) {
      logger.warn(`Candidate ${From} opted out via SMS`);
      // Logic to trigger immediate opt-out workflow
    } else {
      // Logic to process normal reply
    }

    res.status(200).send('<Response></Response>'); // Empty TwiML response
  }
}
