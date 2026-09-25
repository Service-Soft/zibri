import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, defaultTestProviders, StartedTestServer, startTestServer } from 'zibri-testing';

import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

/**
 * Where a test server writes the things an application writes at runtime.
 *
 * The framework records its route history to disk on boot. Pointed at the installed package - which
 * is where it resolved to before there was a token for it - a suite leaves files behind in the
 * project it is testing, and the next run reads them: a second boot at the same version with
 * different controllers is refused, so tests start depending on the order they ran in.
 *
 * So each started server gets a directory of its own and takes it with it. The lifetime is the
 * server rather than the application, which is the whole point of the distinction below.
 */

@Controller('/scratch', { allowOrphan: true, versions: 'all' })
class ScratchController {
    @Get('/')
    get(): { ok: boolean } {
        return { ok: true };
    }
}

// one class for the whole file: each call builds a new one, and a data source that is declared and
// never deployed is refused by name
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource();

/**
 * The file the versioning service writes for the version a server booted at.
 * @param server - The started server.
 * @returns The path it would have been written to.
 */
function versionFileOf(server: StartedTestServer): string {
    return path.join(server.scratchPath, 'versions', '1.0.0.json');
}

describe('a test server\'s scratch directory', () => {

    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('is where the application writes what it records at runtime', async () => {
        server = await startTestServer({ controllers: [ScratchController], dataSources: [dataSourceClass] });

        // written during init, so the server does not even have to be listening
        expect(existsSync(versionFileOf(server))).toBe(true);
    }, 15000);

    it('survives a reInit, because that is a restart rather than a new deployment', async () => {
        server = await startTestServer({ controllers: [ScratchController], dataSources: [dataSourceClass] });
        const versionFile: string = versionFileOf(server);

        await server.reInit({ controllers: [ScratchController], dataSources: [dataSourceClass] });

        // what a restart is for: the second boot finds what the first one recorded. Clearing here
        // would make every reInit a fresh deployment, and no test could ask what an application
        // does when it starts up on a state it left behind.
        expect(existsSync(versionFile)).toBe(true);
    }, 20000);

    it('is removed on shutdown', async () => {
        const started: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
        const scratchPath: string = started.scratchPath;
        expect(existsSync(scratchPath)).toBe(true);

        await started.shutdown();

        expect(existsSync(scratchPath)).toBe(false);
    }, 15000);

    it('yields to a path the test names itself', async () => {
        const ownPath: FsPath = FsUtilities.getPath(__dirname, '__testing__', 'file-output', 'scratch-override');
        await FsUtilities.rm(ownPath);
        // empty rather than absent, which is what a project that has not recorded a version yet looks
        // like. An application refuses to start on a versions folder that is not there at all
        await FsUtilities.mkdir(ownPath);

        server = await startTestServer({
            controllers: [ScratchController],
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.VERSIONS_PATH, useValue: ownPath })
            ]
        });

        // a suite that wants to seed a history, or read one back after the server is gone, says
        // where it lives and the harness stays out of the way
        expect(existsSync(path.join(ownPath, '1.0.0.json'))).toBe(true);
        expect(existsSync(versionFileOf(server))).toBe(false);

        await FsUtilities.rm(ownPath);
    }, 15000);

    it('gives each server its own, so two in one file cannot collide', async () => {
        const first: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
        const firstPath: string = first.scratchPath;
        await first.shutdown();

        server = await startTestServer({ dataSources: [dataSourceClass] });

        expect(server.scratchPath).not.toBe(firstPath);
    }, 20000);
});