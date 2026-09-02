import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch'; // Required for Graph Client in Node
import logger from '../../services/LoggerService.js';

export default class MicrosoftCalendarService {
  constructor(clientConfig) {
    this.client = Client.init({
      authProvider: (done) => {
        // Pass the user's access token from DB
        done(null, clientConfig.microsoftToken); 
      }
    });
  }

  async checkAvailability(startTime, endTime, emails) {
    try {
      const scheduleInformation = {
        schedules: emails,
        startTime: { dateTime: startTime, timeZone: 'UTC' },
        endTime: { dateTime: endTime, timeZone: 'UTC' },
        availabilityViewInterval: 15
      };

      const response = await this.client.api('/me/calendar/getSchedule').post(scheduleInformation);
      return response.value;
    } catch (error) {
      logger.error('Error checking Microsoft 365 availability', error);
      throw error;
    }
  }

  async createInterviewEvent(candidateName, recruiterEmail, candidateEmail, startTime, endTime) {
    const event = {
      subject: `Interview: ${candidateName}`,
      body: { contentType: 'HTML', content: 'Automated interview scheduled via Stratton Candidate Engine.' },
      start: { dateTime: startTime, timeZone: 'UTC' },
      end: { dateTime: endTime, timeZone: 'UTC' },
      attendees: [
        { emailAddress: { address: recruiterEmail }, type: 'required' },
        { emailAddress: { address: candidateEmail }, type: 'required' }
      ],
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness'
    };

    try {
      const response = await this.client.api('/me/events').post(event);
      logger.info(`Interview scheduled successfully via MS Teams`);
      return response;
    } catch (error) {
      logger.error('Failed to create MS Teams interview event', error);
      throw error;
    }
  }
}
