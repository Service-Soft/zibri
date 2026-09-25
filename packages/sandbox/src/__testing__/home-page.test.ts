import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';

/**
 * An example of what testing a Zibri application looks like.
 *
 * The server this drives is the application itself - the same controllers, the same auth, the same
 * lifecycle - so what it answers is what a caller gets.
 */

let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({ application: testApplicationOptions });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

describe('the home page', () => {

    it('is served to anyone', async () => {
        const response: Response = await fetch(baseUrl);

        expect(response.status).toBe(200);
    });
});