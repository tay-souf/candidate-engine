// ============================================
// Microsoft 365 Calendar Integration
// ============================================

import { Client } from '@microsoft/microsoft-graph-client';
import { createLogger } from '../../src/lib/logger.js';

const logger = createLogger({ module: 'Microsoft365Calendar' });

export class Microsoft365CalendarService {
    constructor(credentials) {
        this.credentials = credentials;
        this.client = null;

        if (credentials?.access_token) {
            this._initClient(credentials.access_token);
        }
    }

    _initClient(accessToken) {
        this.client = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });
    }

    /**
     * Get OAuth2 authorization URL
     * @param {string} state 
     * @returns {string}
     */
    getAuthUrl(state) {
        const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
        const params = new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID,
            response_type: 'code',
            redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
            scope: 'Calendars.ReadWrite User.Read offline_access',
            state,
            prompt: 'consent'
        });
        return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
    }

    /**
     * Exchange code for tokens
     * @param {string} code 
     * @returns {Promise<Object>}
     */
    async getTokens(code) {
        const axios = (await import('axios')).default;
        const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
        
        const response = await axios.post(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: process.env.MICROSOFT_CLIENT_ID,
                client_secret: process.env.MICROSOFT_CLIENT_SECRET,
                code,
                redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
                grant_type: 'authorization_code',
                scope: 'Calendars.ReadWrite User.Read offline_access'
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        this._initClient(response.data.access_token);
        return response.data;
    }

    /**
     * Get available time slots
     * @param {string} userId - User email or ID
     * @param {Date} startDate 
     * @param {Date} endDate 
     * @param {number} durationMinutes 
     * @returns {Promise<Array>}
     */
    async getAvailableSlots(userId, startDate, endDate, durationMinutes = 30) {
        try {
            const result = await this.client
                .api(`/users/${userId}/calendar/getSchedule`)
                .post({
                    schedules: [userId],
                    startTime: { dateTime: startDate.toISOString(), timeZone: 'America/New_York' },
                    endTime: { dateTime: endDate.toISOString(), timeZone: 'America/New_York' },
                    availabilityViewInterval: durationMinutes
                });

            const schedule = result.value?.[0];
            if (!schedule) return [];

            const slots = [];
            const availabilityView = schedule.availabilityView || '';
            let current = new Date(startDate);
            const slotMs = durationMinutes * 60 * 1000;

            for (const char of availabilityView) {
                if (char === '0') { // 0 = free
                    const hour = current.getHours();
                    if (hour >= 9 && hour < 18) {
                        slots.push({
                            start: new Date(current),
                            end: new Date(current.getTime() + slotMs)
                        });
                    }
                }
                current = new Date(current.getTime() + slotMs);
            }

            return slots;
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to get Microsoft calendar slots');
            throw error;
        }
    }

    /**
     * Create calendar event
     * @param {Object} eventDetails 
     * @returns {Promise<Object>}
     */
    async createEvent(eventDetails) {
        const {
            userId,
            summary,
            description,
            startTime,
            endTime,
            attendees = [],
            location,
            isOnline = true
        } = eventDetails;

        try {
            const event = await this.client
                .api(`/users/${userId}/events`)
                .post({
                    subject: summary,
                    body: {
                        contentType: 'HTML',
                        content: description
                    },
                    start: {
                        dateTime: startTime.toISOString(),
                        timeZone: 'America/New_York'
                    },
                    end: {
                        dateTime: endTime.toISOString(),
                        timeZone: 'America/New_York'
                    },
                    location: location ? { displayName: location } : undefined,
                    attendees: attendees.map(email => ({
                        emailAddress: { address: email },
                        type: 'required'
                    })),
                    isOnlineMeeting: isOnline,
                    onlineMeetingProvider: isOnline ? 'teamsForBusiness' : undefined,
                    allowNewTimeProposals: false,
                    reminderMinutesBeforeStart: 15
                });

            logger.info({ eventId: event.id, summary }, 'Microsoft calendar event created');

            return {
                eventId: event.id,
                htmlLink: event.webLink,
                meetingLink: event.onlineMeeting?.joinUrl,
                start: event.start,
                end: event.end
            };
        } catch (error) {
            logger.error({ error: error.message }, 'Failed to create Microsoft event');
            throw error;
        }
    }

    /**
     * Cancel event
     * @param {string} userId 
     * @param {string} eventId 
     */
    async cancelEvent(userId, eventId) {
        try {
            await this.client
                .api(`/users/${userId}/events/${eventId}`)
                .delete();
            logger.info({ eventId }, 'Microsoft event cancelled');
        } catch (error) {
            logger.error({ error: error.message, eventId }, 'Failed to cancel Microsoft event');
            throw error;
        }
    }
}
