import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';

let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({ application: testApplicationOptions });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

// a test server runs the framework from node_modules, beside which there are no assets, so what it
// serves comes from the application's own folder
describe('the assets of a test server', () => {

    it.each(['/assets/style.css', '/assets', '/explorer'])('answer %s', async path => {
        const response: Response = await fetch(`${baseUrl}${path}`);

        expect(response.status).toBe(200);
    });
});
