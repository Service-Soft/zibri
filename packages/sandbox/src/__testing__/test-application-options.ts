import { ZibriApplicationOptions } from 'zibri';
import { createInMemoryDataSource, defaultTestProviders } from 'zibri-testing';

import { baseApplicationOptions } from '../application-options.base';
import { entities } from '../data-sources/db/entities';

/**
 * What this application is when a test starts it.
 *
 * The same application, storing its rows in this process rather than in a database, and with the
 * harness's defaults on top of its own providers: work factors sized for a test rather than for an
 * attacker, a scheduler that fires when a test tells it to, and a mail transport that refuses to
 * send. A test that is about one of those registers its own provider for that token and gets the
 * shipped behavior back.
 */
export const testApplicationOptions: ZibriApplicationOptions = {
    ...baseApplicationOptions,
    dataSources: [createInMemoryDataSource({ entities })],
    providers: [...baseApplicationOptions.providers ?? [], ...defaultTestProviders]
};