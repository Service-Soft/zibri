import { afterEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Auth } from '../auth/decorators/auth.decorator';

@Controller('/listen-host')
class ListenHostController {
    @Auth.skip()
    @Get('/')
    read(): string {
        return 'ok';
    }
}

// one class for both boots: a data source class belongs to the application that registered it first
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

afterEach(async () => {
    await server?.shutdown();
    server = undefined;
}, TestTimeouts.inMemory.shutdown);

/**
 * Boots an application to start.
 * @returns The server, not yet listening.
 */
async function bootServer(): Promise<StartedTestServer> {
    return await startTestServer({
        controllers: [ListenHostController],
        dataSources: [dataSourceClass]
    });
}

describe('the address an application listens on', () => {
    it('is the host it is started with', async () => {
        server = await bootServer();

        const baseUrl: string = await server.start('127.0.0.1');

        expect(server.resolveListeningAddress().address).toBe('127.0.0.1');
        expect((await fetch(`${baseUrl}/listen-host`)).status).toBe(200);
    }, TestTimeouts.inMemory.start);

    it('is every address of the machine without one', async () => {
        server = await bootServer();

        await server.start();

        expect(['::', '0.0.0.0']).toContain(server.resolveListeningAddress().address);
    }, TestTimeouts.inMemory.start);
});
