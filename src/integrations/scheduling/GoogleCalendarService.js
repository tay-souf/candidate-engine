import { google } from 'googleapis';
import logger from '../../services/LoggerService.js';

export default class GoogleCalendarService {
  constructor(clientConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    // Assuming the client has authorized and we stored their tokens
    this.oauth2Client.setCredentials(clientConfig.googleTokens);
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  async checkAvailability(startTime, endTime, emails) {
    try {
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startTime,
          timeMax: endTime,
          items: emails.map(email => ({ id: email }))
        }
      });
      return response.data.calendars;
    } catch (error) {
      logger.error('Error checking Google Calendar availability', error);
      throw error;
    }
  }

  async createInterviewEvent(candidateName, recruiterEmail, candidateEmail, startTime, endTime) {
    const event = {
      summary: `Interview: ${candidateName}`,
      description: 'Automated interview scheduled via Stratton Candidate Engine.',
      start: { dateTime: startTime },
      end: { dateTime: endTime },
      attendees: [
        { email: recruiterEmail },
        { email: candidateEmail }
      ],
      conferenceData: {
        createRequest: { requestId: `meet-${Date.now()}` }
      }
    };

    try {
      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all' // Sends email notifications
      });
      
      logger.info(`Interview scheduled successfully: ${response.data.htmlLink}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to create interview event', error);
      throw error;
    }
  }
}
