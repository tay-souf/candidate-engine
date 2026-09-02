/**
 * Communication Templates
 * Stores standardized templates for SMS and AI Voice Prompts
 */
export const Templates = {
  SMS: {
    INITIAL_OUTREACH: "Hi {{firstName}}, this is {{recruiterName}} from {{clientName}}. We have a new {{jobTitle}} position in {{jobLocation}} paying {{payRate}}. Are you interested in learning more? Reply YES or STOP to opt out.",
    FOLLOW_UP_1: "Hi {{firstName}}, just following up on the {{jobTitle}} role. Let me know if you're available for a quick chat today. Reply STOP to opt out.",
    FOLLOW_UP_2: "Hi {{firstName}}, I haven't heard back so I'll assume you're not looking right now. If things change, keep my number. Have a great day!",
    INTERVIEW_CONFIRMATION: "Great! Your interview with {{recruiterName}} is confirmed for {{interviewTime}}. A calendar invite has been sent to your email.",
  },
  
  VOICE: {
    // Retell AI System Prompts
    QUALIFICATION_AGENT: `You are {{recruiterName}}, a professional recruiter at {{clientName}}.
Your goal is to qualify the candidate, {{firstName}}, for a {{jobTitle}} position.

Follow these rules:
1. Be polite, concise, and professional.
2. Ask if they are currently looking for new opportunities.
3. If yes, ask about their experience with {{requiredSkills}}.
4. Ask if they are comfortable with the pay rate of {{payRate}}.
5. If they are a good fit, ask them what time tomorrow works best for a 10-minute interview.
6. If they say they are not interested, politely thank them and end the call immediately.

Do NOT sound like a robot. Use conversational fillers naturally.`,
  }
};
