// ============================================
// Google Calendar Integration
// ============================================

import { google } from 'googleapis';
import { createLogger } from '../../src/lib/logger.js';

const logger = createLogger({ module: 'GoogleCalendar' });

export class GoogleCalendarService {
    constructor(credentials) {
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        if (credentials?.access_token) {
            this.oauth2Client.setCredentials({
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token,
                expiry_date: credentials.expiry_date
            });
        }

        this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    }

    /**
     * Generate OAuth2 authorization URL
     * @param {string} state - State parameter for callback
     * @returns {string}
     */
    getAuthUrl(state) {
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events'
            ],
            state,
            prompt: 'consent'
        });
    }

    /**
     * Exchange authorization code for tokens
     * @param {string} code 
     * @returns {Promise<Object>}
     */
    async getTokens(code) {
        const { tokens } = await this.oauth2Client.getToken(code);
        this.oauth2Client.setCredentials(tokens);
        return tokens;
    }

    /**
     * Get available time slots for a recruiter
     * @param {string} calendarId - Calendar ID
     * @param {Date} startDate - Start of search range
     * @param {Date} endDate - End of search range
     * @param {number} durationMinutes - Slot duration
     * @returns {Promise<Array>}
     */
    async getAvailableSlots(calendarId, startDate, endDate, durationMinutes = 30) {
        try {
            // Get busy times
            const freeBusy = await this.calendar.freebusy.query({
                requestBody: {
                    timeMin: startDate.toISOString(),
                    timeMax: endDate.toISOString(),
                    items: [{ id: calendarId }]
                }
            });

            const busySlots = freeBusy.data.calendars[calendarId]?.busy || [];
            
            // Generate available slots
            const slots = [];
            const slotDuration = durationMinutes * 60 * 1000;
            const buffer = 10 * 60 * 1000; // 10 min buffer
            let current = new Date(startDate);

            while (current.getTime() + slotDuration <= endDate.getTime()) {
                const slotEnd = new Date(current.getTime() + slotDuration);
                
                // Check business hours (9 AM - 6 PM)
                const hour = current.getHours();
                if (hour >= 9 && hour < 18) {
                    // Check if slot conflicts with any busy time
                    const isBusy = busySlots.some(busy => {
                        const busyStart = new Date(busy.start);
                        const busyEnd = new Date(busy.end);
                        return current < busyEnd && slotEnd > busyStart;
                    });

                    if (!isBusy) {
                        slots.push({
                            start: new Date(current),
                            end: slotEnd
                        });
                    }
                }

                current = new Date(current.getTime() + slotDuration + buffer);
            }

            return slots;
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to get available slots');
            throw error;
        }
    }

    /**
     * Create a calendar event (interview appointment)
     * @param {Object} eventDetails
     * @returns {Promise<Object>}
     */
    async createEvent(eventDetails) {
        const {
            calendarId,
            summary,
            description,
            startTime,
            endTime,
            attendees = [],
            location,
            meetingLink,
            reminders = true
        } = eventDetails;

        try {
            const event = await this.calendar.events.insert({
                calendarId,
                requestBody: {
                    summary,
                    description,
                    location,
                    start: {
                        dateTime: startTime.toISOString(),
                        timeZone: 'America/New_York'
                    },
                    end: {
                        dateTime: endTime.toISOString(),
                        timeZone: 'America/New_York'
                    },
                    attendees: attendees.map(email => ({ email })),
                    conferenceData: meetingLink ? undefined : {
                        createRequest: {
                            requestId: `sce-${Date.now()}`,
                            conferenceSolutionKey: { type: 'hangoutsMeet' }
                        }
                    },
                    reminders: reminders ? {
                        useDefault: false,
                        overrides: [
                            { method: 'email', minutes: 60 },
                            { method: 'popup', minutes: 15 }
                        ]
                    } : { useDefault: true }
                },
                conferenceDataVersion: meetingLink ? 0 : 1,
                sendUpdates: 'all'
            });

            logger.info({ eventId: event.data.id, summary }, 'Calendar event created');
            
            return {
                eventId: event.data.id,
                htmlLink: event.data.htmlLink,
                meetingLink: event.data.conferenceData?.entryPoints?.[0]?.uri || meetingLink,
                start: event.data.start,
                end: event.data.end
            };
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to create calendar event');
            throw error;
        }
    }

    /**
     * Cancel a calendar event
     * @param {string} calendarId 
     * @param {string} eventId 
     */
    async cancelEvent(calendarId, eventId) {
        try {
            await this.calendar.events.delete({
                calendarId,
                eventId,
                sendUpdates: 'all'
            });
            logger.info({ eventId }, 'Calendar event cancelled');
        } catch (error) {
            logger.error({ error: error.message, eventId }, 'Failed to cancel event');
            throw error;
        }
    }

    /**
     * Update a calendar event
     * @param {string} calendarId 
     * @param {string} eventId 
     * @param {Object} updates 
     */
    async updateEvent(calendarId, eventId, updates) {
        try {
            const event = await this.calendar.events.patch({
                calendarId,
                eventId,
                requestBody: updates,
                sendUpdates: 'all'
            });
            logger.info({ eventId }, 'Calendar event updated');
            return event.data;
        } catch (error) {
            logger.error({ error: error.message, eventId }, 'Failed to update event');
            throw error;
        }
    }
}
