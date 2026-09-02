import logger from './LoggerService.js';

export default class QualificationService {
  
  /**
   * Evaluates a candidate's profile and extracted call transcripts
   * to determine if they meet the job requirements.
   * 
   * @param {Object} candidate - Normalized Candidate Object
   * @param {Object} jobOrder - Normalized Job Order Object
   * @param {Object} callData - Data extracted from Retell AI Call
   * @returns {Object} Qualification Result { isQualified: boolean, score: number, notes: string }
   */
  static evaluateCandidate(candidate, jobOrder, callData) {
    let score = 0;
    const notes = [];

    // 1. Check Interest
    if (callData.isInterested === false) {
      return { isQualified: false, score: 0, notes: 'Candidate explicitly stated they are not interested.' };
    }

    // 2. Evaluate Experience
    const requiredYears = jobOrder.experience_min_years || 0;
    if (candidate.experience_years >= requiredYears) {
      score += 40;
      notes.push(`Meets experience requirement (${candidate.experience_years} years).`);
    } else {
      notes.push(`Short on experience (Has ${candidate.experience_years}, needs ${requiredYears}).`);
    }

    // 3. Evaluate Skills Match from Transcript Extracted Data
    if (callData.skillsConfirmed && jobOrder.skills_required) {
      let matchedSkills = 0;
      jobOrder.skills_required.forEach(skill => {
        if (callData.skillsConfirmed.includes(skill)) {
          matchedSkills++;
        }
      });
      const skillScore = (matchedSkills / jobOrder.skills_required.length) * 40;
      score += skillScore;
      notes.push(`Matched ${matchedSkills}/${jobOrder.skills_required.length} required skills.`);
    }

    // 4. Pay Rate Expectations
    if (callData.acceptedPayRate || (candidate.desired_pay_rate <= jobOrder.pay_rate_max)) {
      score += 20;
      notes.push('Pay rate expectations align with job order.');
    } else {
      notes.push('Pay rate expectations exceed job order max.');
    }

    // Threshold for passing
    const isQualified = score >= 70; // 70% match threshold
    
    logger.info(`Candidate ${candidate.ats_candidate_id} evaluated for Job ${jobOrder.ats_job_id}. Score: ${score}, Qualified: ${isQualified}`);

    return {
      isQualified,
      score,
      details: notes.join(' ')
    };
  }
}
