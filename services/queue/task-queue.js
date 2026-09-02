// ============================================
// Task Queue - BullMQ based job queue
// ============================================

import { Queue, Worker, QueueScheduler } from 'bullmq';
import { createLogger } from '../../src/lib/logger.js';

const logger = createLogger({ module: 'TaskQueue' });

const REDIS_CONNECTION = {
    host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
    port: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).port : 6379,
    password: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).password : undefined,
    maxRetriesPerRequest: null
};

// Queue definitions
const QUEUES = {
    OUTREACH: 'outreach',
    VOICE_CALLS: 'voice-calls',
    SMS: 'sms',
    FOLLOW_UP: 'follow-up',
    QUALIFICATION: 'qualification',
    SCHEDULING: 'scheduling',
    ATS_SYNC: 'ats-sync',
    ATS_WRITEBACK: 'ats-writeback',
    NOTIFICATIONS: 'notifications'
};

export class TaskQueue {
    constructor() {
        this.queues = {};
        this.workers = {};
    }

    /**
     * Initialize all queues
     */
    async initialize() {
        for (const [name, queueName] of Object.entries(QUEUES)) {
            this.queues[name] = new Queue(queueName, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000
                    },
                    removeOnComplete: {
                        age: 86400,  // Keep completed jobs for 24h
                        count: 1000
                    },
                    removeOnFail: {
                        age: 604800  // Keep failed jobs for 7 days
                    }
                }
            });
        }

        logger.info(`Initialized ${Object.keys(QUEUES).length} task queues`);
    }

    /**
     * Add a job to a queue
     * @param {string} queueName - Queue identifier (from QUEUES)
     * @param {string} jobName - Job name/type
     * @param {Object} data - Job data
     * @param {Object} options - Job options (delay, priority, etc.)
     * @returns {Promise<Object>}
     */
    async addJob(queueName, jobName, data, options = {}) {
        const queue = this.queues[queueName];
        if (!queue) {
            throw new Error(`Queue "${queueName}" not found`);
        }

        const job = await queue.add(jobName, data, {
            ...options,
            // Prevent duplicate jobs
            jobId: options.jobId || undefined
        });

        logger.debug({ 
            queue: queueName, 
            jobName, 
            jobId: job.id 
        }, 'Job added to queue');

        return job;
    }

    /**
     * Add a delayed job
     * @param {string} queueName 
     * @param {string} jobName 
     * @param {Object} data 
     * @param {number} delayMs - Delay in milliseconds
     * @returns {Promise<Object>}
     */
    async addDelayedJob(queueName, jobName, data, delayMs) {
        return this.addJob(queueName, jobName, data, { delay: delayMs });
    }

    /**
     * Add a scheduled job (cron-like)
     * @param {string} queueName 
     * @param {string} jobName 
     * @param {Object} data 
     * @param {string} cronExpression - Cron expression
     * @returns {Promise<Object>}
     */
    async addRepeatingJob(queueName, jobName, data, cronExpression) {
        return this.addJob(queueName, jobName, data, {
            repeat: { pattern: cronExpression }
        });
    }

    /**
     * Add a bulk of jobs to a queue
     * @param {string} queueName 
     * @param {Array<{name, data, opts}>} jobs 
     */
    async addBulkJobs(queueName, jobs) {
        const queue = this.queues[queueName];
        if (!queue) throw new Error(`Queue "${queueName}" not found`);

        await queue.addBulk(jobs);
        logger.info({ queue: queueName, count: jobs.length }, 'Bulk jobs added');
    }

    /**
     * Register a worker for a queue
     * @param {string} queueName 
     * @param {Function} processor - Job processor function
     * @param {Object} options - Worker options
     */
    registerWorker(queueName, processor, options = {}) {
        const queue = this.queues[queueName];
        if (!queue) throw new Error(`Queue "${queueName}" not found`);

        const worker = new Worker(
            QUEUES[queueName] || queueName,
            async (job) => {
                logger.info({ 
                    queue: queueName, 
                    jobName: job.name, 
                    jobId: job.id,
                    attempt: job.attemptsMade + 1
                }, 'Processing job');

                try {
                    const result = await processor(job);
                    return result;
                } catch (error) {
                    logger.error({ 
                        queue: queueName, 
                        jobId: job.id, 
                        error: error.message,
                        attempt: job.attemptsMade + 1,
                        maxAttempts: job.opts.attempts
                    }, 'Job failed');
                    throw error;
                }
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: options.concurrency || 5,
                limiter: options.limiter || undefined
            }
        );

        // Event handlers
        worker.on('completed', (job) => {
            logger.debug({ queue: queueName, jobId: job.id }, 'Job completed');
        });

        worker.on('failed', (job, error) => {
            logger.error({ 
                queue: queueName, 
                jobId: job?.id, 
                error: error.message 
            }, 'Job failed permanently');
        });

        worker.on('error', (error) => {
            logger.error({ queue: queueName, error: error.message }, 'Worker error');
        });

        this.workers[queueName] = worker;
        logger.info({ queue: queueName }, 'Worker registered');
    }

    /**
     * Get queue statistics
     * @param {string} queueName 
     * @returns {Promise<Object>}
     */
    async getQueueStats(queueName) {
        const queue = this.queues[queueName];
        if (!queue) return null;

        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount()
        ]);

        return { waiting, active, completed, failed, delayed };
    }

    /**
     * Get all queue statistics
     * @returns {Promise<Object>}
     */
    async getAllStats() {
        const stats = {};
        for (const name of Object.keys(this.queues)) {
            stats[name] = await this.getQueueStats(name);
        }
        return stats;
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('Shutting down task queues...');
        
        for (const worker of Object.values(this.workers)) {
            await worker.close();
        }
        
        for (const queue of Object.values(this.queues)) {
            await queue.close();
        }

        logger.info('All queues shut down');
    }
}

export { QUEUES };
