import { mkdirSync, readdirSync, rmSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

let emptyVersions: FsPath;

beforeAll(() => {
    emptyVersions = FsUtilities.getPath(testFileFolder, `versions-production-${UUIDUtilities.generate()}`);
    mkdirSync(emptyVersions, { recursive: true });
});

afterAll(() => {
    rmSync(emptyVersions, { recursive: true, force: true });
});

// the record was written wherever the application ran, so an
// empty folder mounted where it belongs in a read-only image was taken for a project that had never
// released anything, and every check against the versions before was dropped
describe('a production application whose versions folder does not record its version', () => {
    it('refuses to start, saying how to record it, and writes nothing', async () => {
        let server: StartedTestServer | undefined;
        try {
            await expect((async () => {
                server = await startTestServer({
                    environment: 'production',
                    version: '2.0.0',
                    dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
                    providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.VERSIONS_PATH, useValue: emptyVersions })]
                });
            })()).rejects.toThrow(/2\.0\.0[\S\s]*development/);
        }
        finally {
            await server?.shutdown();
        }
        expect(readdirSync(emptyVersions)).toStrictEqual([]);
    }, TestTimeouts.inMemory.start);
});