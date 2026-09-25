import { ZibriApplicationOptions } from 'zibri';

import { baseApplicationOptions } from './application-options.base';
import { DbDataSource } from './data-sources';

/**
 * What this application is, as the entry point starts it.
 *
 * Exported rather than written inline so that a test builds the application from the same thing the
 * deployment does, and names only what it changes.
 */
export const applicationOptions: ZibriApplicationOptions = {
    ...baseApplicationOptions,
    dataSources: [DbDataSource]
};