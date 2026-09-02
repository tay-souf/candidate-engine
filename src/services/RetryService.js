import logger from './LoggerService.js';

/**
 * Retry and Error Handling Service
 * Implements exponential backoff for failed API requests
 */
export default class RetryService {
  
  /**
   * Executes a function with automatic retries and exponential backoff
   * @param {Function} asyncFunction - The function to execute
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} baseDelayMs - Base delay in milliseconds
   */
  static async executeWithRetry(asyncFunction, maxRetries = 3, baseDelayMs = 1000) {
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        return await asyncFunction();
      } catch (error) {
        attempt++;
        
        // Don't retry on certain critical errors (e.g., 401 Unauthorized, 400 Bad Request)
        if (error.response && [400, 401, 403, 404].includes(error.response.status)) {
          logger.error(`Critical API error ${error.response.status}, aborting retries.`);
          throw error;
        }

        if (attempt >= maxRetries) {
          logger.error(`Failed after ${maxRetries} attempts: ${error.message}`);
          throw error;
        }
        
        // Exponential backoff: 1s, 2s, 4s, 8s...
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}
