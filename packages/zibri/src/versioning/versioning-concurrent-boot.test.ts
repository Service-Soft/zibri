import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { VersionFile } from './version.model';
import { VersioningService } from './versioning.service';
import { testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZibriApplication } from '../application/application';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { AfterAppInit } from '../global/after-app-init.interface';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

const sharedVersionsDir: FsPath = FsUtilities.getPath(testFileFolder, 'versions-concurrent-boot');

let application: ZibriApplication | undefined;

/**
 * Hands the test the application, which is what the versioning service reads its routes from.
 */
@Injectable()
class ApplicationProbe implements AfterAppInit {
    afterAppInit(app: ZibriApplication): void {
        application = app;
    }
}

@Controller('/concurrent-boot', { allowOrphan: true })
class ConcurrentBootController {
    @Get('/')
    get(): {} {
        return {};
    }
}

/**
 * The versioning service of another instance of the application, reading and writing the given folder.
 * @param versionsPath - The versions folder.
 * @returns The service.
 */
function createInstance(versionsPath: FsPath): VersioningService {
    return new VersioningService(
        inject(ZIBRI_DI_TOKENS.VERSION_HEADER),
        inject(ZIBRI_DI_TOKENS.VERSION_QUERY_PARAM),
        inject(ZIBRI_DI_TOKENS.ROUTER),
        versionsPath
    );
}

describe('VersioningService — instances starting together on one versions folder', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            version: '1.0.0',
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            controllers: [ConcurrentBootController],
            providers: defaultTestServerProviders,
            additionalLifecycleServices: [ApplicationProbe]
        });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(sharedVersionsDir);
    }, 15000);

    it('records the first version once, and every instance starts', async () => {
        if (application == undefined) {
            throw new Error('The application was not handed over.');
        }
        const app: ZibriApplication = application;
        await FsUtilities.rm(sharedVersionsDir);

        // what replicas of one deployment do when they come up at the same moment on a shared folder:
        // one reads it empty and finds it written by the other by the time it writes itself. Where the
        // second one starts decides whether it lands in that window, so every pair starts it a few
        // turns of the event loop later than the one before, each pair on a folder of its own
        // one pair after the other, so no pair's timing is another's
        for (let turns: number = 0; turns < 60; turns++) {
            const folder: FsPath = FsUtilities.getPath(sharedVersionsDir, String(turns));
            await FsUtilities.mkdir(folder);
            const first: Promise<void> = createInstance(folder).afterAppInit(app);
            for (let turn: number = 0; turn < turns; turn++) {
                await new Promise(resolve => setImmediate(resolve));
            }
            await Promise.all([first, createInstance(folder).afterAppInit(app)]);

            const recorded: VersionFile = JsonUtilities.parse(await FsUtilities.readFile(FsUtilities.getPath(folder, '1.0.0.json')));
            expect(recorded.value).toBe('1.0.0');
            expect(recorded.routes.map(route => route.key)).toContain('GET /concurrent-boot/');
        }
    }, 30000);
});