import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DocsUtilities } from 'zibri';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';
import { DOCS_SITE } from '../templates/docs/docs-site';

let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({ application: testApplicationOptions });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

describe('the documentation', () => {

    it('serves every page of the navigation at the address its file gives it', async () => {
        for (const page of DocsUtilities.resolvePages(DOCS_SITE)) {
            const response: Response = await fetch(`${baseUrl}${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}`);

            expect(response.status).toBe(200);
        }
    });

    it('lets the search find every page', async () => {
        const index: string = await (await fetch(`${baseUrl}${DocsUtilities.resolveSearchIndexAddress(DOCS_SITE)}`)).text();

        for (const page of DocsUtilities.resolvePages(DOCS_SITE)) {
            expect(index).toContain(`"address":"${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}"`);
        }
    });
});