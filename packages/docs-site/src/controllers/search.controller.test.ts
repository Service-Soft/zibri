import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { JsonUtilities } from 'zibri';
import { StartedTestServer } from 'zibri-testing';

import { startDocsSite } from '../__testing__/start-docs-site.function';
import { SearchEntry } from '../search/search-entry.model';

describe('the index of the search', () => {
    let server: StartedTestServer;
    let entries: SearchEntry[];

    beforeAll(async () => {
        server = await startDocsSite();
        const response: Response = await fetch(`${await server.start()}/zibri/search/v1/index.json`);
        expect(response.headers.get('content-type')).toContain('application/json');
        entries = JsonUtilities.parse(await response.text());
    }, 60_000);

    afterAll(async () => {
        await server.shutdown();
    }, 30_000);

    it('holds every page in its folder, with the keywords of its frontmatter', () => {
        expect(entries).toContainEqual(expect.objectContaining({
            title: 'Two factor',
            address: '/zibri/auth/two-factor/',
            context: 'Auth',
            keywords: expect.arrayContaining(['2fa', 'mfa'])
        }));
    });

    it('holds every section of a page under its anchor, and every export with the badge of its kind', () => {
        expect(entries).toContainEqual(expect.objectContaining({
            title: 'Replacing a service',
            address: '/zibri/application/configuration/#replacing-a-service',
            context: 'Configuring the framework'
        }));
        expect(entries).toContainEqual(expect.objectContaining({
            title: 'Passkey',
            address: '/zibri/api/Passkey/',
            badge: expect.objectContaining({ letter: 'E' })
        }));
    });
});