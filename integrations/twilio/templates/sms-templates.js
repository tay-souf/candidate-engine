// ============================================
// SMS Templates - Outreach Messages
// ============================================

export const SMS_TEMPLATES = {

    // ==========================================
    // Initial Outreach
    // ==========================================
    initial_outreach: {
        name: 'Initial Outreach',
        channel: 'sms',
        type: 'initial_outreach',
        body: `Hi {{candidate_name}}! This is {{company_name}}. We have a {{job_title}} opportunity near {{location}} paying {{pay_rate}}. Interested? Reply YES to learn more or STOP to opt out.`,
        variables: ['candidate_name', 'company_name', 'job_title', 'location', 'pay_rate']
    },

    initial_outreach_detailed: {
        name: 'Initial Outreach (Detailed)',
        channel: 'sms',
        type: 'initial_outreach',
        body: `Hi {{candidate_name}}, it's {{recruiter_name}} from {{company_name}}. We're looking for a {{job_title}} in {{location}} — {{pay_rate}}, starting {{start_date}}. Your background looks like a great match! Reply YES if you'd like to hear more. Reply STOP to unsubscribe.`,
        variables: ['candidate_name', 'recruiter_name', 'company_name', 'job_title', 'location', 'pay_rate', 'start_date']
    },

    // ==========================================
    // Follow-Up Messages
    // ==========================================
    follow_up_1: {
        name: 'Follow-Up #1 (24h)',
        channel: 'sms',
        type: 'follow_up',
        body: `Hi {{candidate_name}}, just following up on the {{job_title}} position we mentioned. It's a great opportunity at {{pay_rate}} in {{location}}. Would you like to learn more? Reply YES or STOP to opt out.`,
        variables: ['candidate_name', 'job_title', 'pay_rate', 'location']
    },

    follow_up_2: {
        name: 'Follow-Up #2 (48h)',
        channel: 'sms',
        type: 'follow_up',
        body: `Hey {{candidate_name}}, quick check-in about the {{job_title}} role. Spots are filling up and we'd love to get you in front of the hiring team. Interested? Reply YES. Reply STOP to unsubscribe.`,
        variables: ['candidate_name', 'job_title']
    },

    follow_up_final: {
        name: 'Final Follow-Up (72h)',
        channel: 'sms',
        type: 'follow_up',
        body: `Last check-in, {{candidate_name}}! The {{job_title}} position near {{location}} is still open. If you're interested, reply YES and we'll get you connected right away. Reply STOP to unsubscribe.`,
        variables: ['candidate_name', 'job_title', 'location']
    },

    // ==========================================
    // Qualification
    // ==========================================
    qualification_interested: {
        name: 'Response to Interest',
        channel: 'sms',
        type: 'qualification',
        body: `Great to hear from you, {{candidate_name}}! 🎉 The {{job_title}} role pays {{pay_rate}} and is located in {{location}}. One of our recruiters will give you a quick call shortly to discuss details. What's the best time to reach you?`,
        variables: ['candidate_name', 'job_title', 'pay_rate', 'location']
    },

    // ==========================================
    // Scheduling
    // ==========================================
    interview_scheduled: {
        name: 'Interview Scheduled',
        channel: 'sms',
        type: 'scheduling',
        body: `Hi {{candidate_name}}! Your interview for the {{job_title}} position is confirmed for {{appointment_date}} at {{appointment_time}}. You'll be speaking with {{recruiter_name}}. {{meeting_details}} Reply CONFIRM to confirm.`,
        variables: ['candidate_name', 'job_title', 'appointment_date', 'appointment_time', 'recruiter_name', 'meeting_details']
    },

    interview_reminder: {
        name: 'Interview Reminder',
        channel: 'sms',
        type: 'scheduling',
        body: `Reminder: Your interview for {{job_title}} is tomorrow at {{appointment_time}} with {{recruiter_name}}. {{meeting_details}} See you then! 👍`,
        variables: ['job_title', 'appointment_time', 'recruiter_name', 'meeting_details']
    },

    // ==========================================
    // Confirmation
    // ==========================================
    opt_out_confirmation: {
        name: 'Opt-Out Confirmation',
        channel: 'sms',
        type: 'opt_out_confirm',
        body: `You've been unsubscribed and will no longer receive messages from {{company_name}}. If you ever want to reconnect, reply START. Thank you!`,
        variables: ['company_name']
    },

    application_received: {
        name: 'Application Received',
        channel: 'sms',
        type: 'confirmation',
        body: `Thanks, {{candidate_name}}! We've received your information for the {{job_title}} role. Our team will review and get back to you within 24-48 hours. Reply STOP to opt out.`,
        variables: ['candidate_name', 'job_title']
    }
};

/**
 * Render an SMS template with variables
 * @param {string} templateKey - Template key from SMS_TEMPLATES
 * @param {Object} variables - Variable values to substitute
 * @returns {string} Rendered message
 */
export function renderSMSTemplate(templateKey, variables = {}) {
    const template = SMS_TEMPLATES[templateKey];
    if (!template) {
        throw new Error(`SMS template "${templateKey}" not found`);
    }

    let message = template.body;
    for (const [key, value] of Object.entries(variables)) {
        message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }

    // Check for any remaining unsubstituted variables
    const remaining = message.match(/\{\{(\w+)\}\}/g);
    if (remaining) {
        const missing = remaining.map(m => m.replace(/[{}]/g, ''));
        throw new Error(`Missing template variables: ${missing.join(', ')}`);
    }

    return message;
}

/**
 * Get all available templates
 * @returns {Object}
 */
export function getAvailableTemplates() {
    return Object.entries(SMS_TEMPLATES).map(([key, template]) => ({
        key,
        name: template.name,
        type: template.type,
        variables: template.variables,
        preview: template.body
    }));
}
