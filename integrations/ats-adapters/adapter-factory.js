// ============================================
// ATS Adapter Factory
// Creates the correct adapter based on platform
// ============================================

import { BullhornAdapter } from './bullhorn-adapter.js';
import { AvionteAdapter } from './avionte-adapter.js';
import { CeipalAdapter } from './ceipal-adapter.js';
import { RecruitCRMAdapter } from './recruit-crm-adapter.js';
import { SalesforceAdapter } from './salesforce-adapter.js';
import { createLogger } from '../../src/lib/logger.js';

const logger = createLogger({ module: 'ATSAdapterFactory' });

const ADAPTERS = {
    bullhorn: BullhornAdapter,
    avionte: AvionteAdapter,
    ceipal: CeipalAdapter,
    recruit_crm: RecruitCRMAdapter,
    salesforce: SalesforceAdapter
};

/**
 * Create an ATS adapter for the given connection
 * @param {Object} connection - ATS connection record from database
 * @returns {BaseATSAdapter}
 */
export function createATSAdapter(connection) {
    const platform = connection.platform?.toLowerCase();
    const AdapterClass = ADAPTERS[platform];

    if (!AdapterClass) {
        const available = Object.keys(ADAPTERS).join(', ');
        throw new Error(
            `Unsupported ATS platform: "${platform}". Available: ${available}`
        );
    }

    logger.info({ platform, clientId: connection.client_id }, 'Creating ATS adapter');
    return new AdapterClass(connection);
}

/**
 * Get list of supported platforms
 * @returns {string[]}
 */
export function getSupportedPlatforms() {
    return Object.keys(ADAPTERS);
}

/**
 * Check if a platform is supported
 * @param {string} platform 
 * @returns {boolean}
 */
export function isPlatformSupported(platform) {
    return platform?.toLowerCase() in ADAPTERS;
}
