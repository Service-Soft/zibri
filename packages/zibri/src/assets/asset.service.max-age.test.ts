import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { KnownHeader } from '../http/known-header.enum';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

const assetsPath: FsPath = FsUtilities.getPath(testFileFolder, 'asset-max-age');
const publicAssetsPath: FsPath = FsUtilities.getPath(assetsPath, 'public');

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'logo.svg'), '<svg/>', true);
    await FsUtilities.createFile(FsUtilities.getPath(publicAssetsPath, 'favicon.png'), 'favicon', true);
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.ASSETS_PATH, useValue: assetsPath }),
            defineProvider({ token: ZIBRI_DI_TOKENS.PUBLIC_ASSETS_MAX_AGE_IN_MS, useValue: Ms.DAY })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(assetsPath);
}, TestTimeouts.inMemory.shutdown);

describe('the public assets max age', () => {
    it.each(['/assets/logo.svg', '/favicon.ico'])('lets a browser keep %s for as long as it says', async path => {
        const res: Response = await fetch(`${baseUrl}${path}`);

        expect(res.status).toBe(200);
        expect(res.headers.get(KnownHeader.CACHE_CONTROL)).toBe('public, max-age=86400');
    });
});
