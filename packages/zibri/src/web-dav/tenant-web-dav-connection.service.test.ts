import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { TenantWebDavConnection } from './tenant-web-dav-connection.model';
import { WebDavConnectionKind } from './web-dav-connection-kind.enum';

/**
 * What the test of a connection of a tenant refuses before anything is sent, under the options by default: any public
 * host, over https. What a server answers is held by the routes in the calendar sync cases of the projects plugin.
 */
describe('TenantWebDavConnectionService, testing a connection', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, TenantWebDavConnection], repositories: defaultTestServerRepositories })],
            providers: [...defaultTestServerProviders]
        });
        await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    async function findRefusal(url: string, kind: WebDavConnectionKind = WebDavConnectionKind.WEB_DAV): Promise<string | undefined> {
        try {
            await inject(ZIBRI_DI_TOKENS.TENANT_WEB_DAV_CONNECTION_SERVICE).validateConnection({ kind, url, username: 'ada', password: 'app-password' });
            return undefined;
        }
        catch (error) {
            return error instanceof BadRequestError ? error.message : `not a BadRequestError: ${String(error)}`;
        }
    }

    it('refuses a url that is none, and one over plain http', async () => {
        expect(await findRefusal('cloud.example.com/remote.php/dav/')).toBe(
            'The url of a WebDAV connection needs to be an absolute url, such as https://cloud.example.com/remote.php/dav/.'
        );
        expect(await findRefusal('http://cloud.example.com/remote.php/dav/')).toBe('The url of a WebDAV connection needs to start with https://.');
        expect(await findRefusal('ftp://cloud.example.com/')).toBe('The url of a WebDAV connection needs to start with https://.');
    });

    it('refuses a host of this machine and of a private network', async () => {
        expect(await findRefusal('https://127.0.0.1/remote.php/dav/')).toBe(
            'The host of a WebDAV connection needs to lead to public addresses only, and 127.0.0.1 does not.'
        );
        expect(await findRefusal('https://[::ffff:10.0.0.1]/remote.php/dav/')).toContain('needs to lead to public addresses only');
    });

    it('refuses a Nextcloud whose url is not below /remote.php/dav/, before its host is looked up', async () => {
        const refusal: string = 'The url of a Nextcloud connection needs to be below /remote.php/dav/ of the server, such as https://cloud.example.com/remote.php/dav/.';

        expect(await findRefusal('https://127.0.0.1/remote.php/webdav/', WebDavConnectionKind.NEXTCLOUD)).toBe(refusal);
        expect(await findRefusal('https://127.0.0.1/dav/files/ada/', WebDavConnectionKind.NEXTCLOUD)).toBe(refusal);
        expect(await findRefusal('https://127.0.0.1/nextcloud/remote.php/dav/files/ada/', WebDavConnectionKind.NEXTCLOUD)).toContain('needs to lead to public addresses only');
    });
});