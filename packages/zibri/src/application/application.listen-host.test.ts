import { Server } from 'node:http';

import { afterEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { CronService } from '../cron/cron.service';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { LogLevel } from '../logging/log-level.enum';
import { Log } from '../logging/log.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';

@Controller('/listen-host')
class ListenHostController {
    @Auth.skip()
    @Get('/')
    read(): string {
        return 'ok';
    }
}

/**
 * An ordinary application service, registered the way any consumer's would be.
 *
 * Which application an injected service belongs to is not otherwise observable: two applications
 * sharing a container are handed the identical object and nothing says so.
 */
@Injectable()
class LifecycleService {}

/**
 * Every tick the job below has run.
 */
const ticks: number[] = [];

/**
 * A job that fires as soon as it is scheduled, which turns "the job was scheduled" into "the job ran".
 */
class StartupCronJob extends CronJob {
    initialConfig: InitialCronConfig = {
        name: 'startup marker',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: true,
        runsOn: 'everyInstance',
        syncToDataSource: false
    };

    onTick(): void {
        ticks.push(Date.now());
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

describe('starting to listen', () => {
    // a bind failure is announced on the server an event after listen() was called, so without
    // something waiting for it start() would resolve, say the application is running, and only then
    // would the process die - the caller never getting to handle the startup failure it is most likely
    // to hit
    it('rejects start() when the port is already taken', async () => {
        const blocker: Server = new Server();
        await new Promise<void>(resolve => blocker.listen(0, resolve));
        const address: ReturnType<Server['address']> = blocker.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('could not resolve the blocked port');
        }
        try {
            server = await bootServer();

            await expect(server['app'].start(address.port)).rejects.toThrow();
        }
        finally {
            await new Promise<void>(resolve => blocker.close(() => resolve()));
        }
    }, TestTimeouts.inMemory.start);

    it('survives an error the server emits once it is listening, and logs it', async () => {
        server = await bootServer();
        const baseUrl: string = await server.start();

        // emitted rather than provoked, because the real trigger cannot be staged: node raises this
        // when accept() fails, which needs the process to be out of file descriptors. An 'error' with
        // no listener is thrown by emit itself
        expect(() => server?.['app'].server.emit('error', new Error('accept EMFILE'))).not.toThrow();

        // the connections already open are unaffected, which is why ending the process here would be
        // the wrong answer to a moment of pressure
        expect((await fetch(`${baseUrl}/listen-host`)).status).toBe(200);
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({ where: { level: LogLevel.ERROR } });
        expect(logs.some(l => l.context.error?.paragraphs.some(p => p.includes('accept EMFILE')) === true)).toBe(true);
    }, TestTimeouts.inMemory.start);

    // a pod that never becomes ready must not have run the nightly job: no readiness probe could have
    // passed and no operator could have aborted the deploy before it listens
    it('runs no scheduled work until the application listens, and runs it once it does', async () => {
        ticks.length = 0;
        server = await startTestServer({
            controllers: [ListenHostController],
            dataSources: [dataSourceClass],
            // the shared providers replace the cron service with an inert one, so the real one is put
            // back, or there is no scheduling to observe the timing of
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })],
            cronJobs: [StartupCronJob]
        });
        expect(ticks).toHaveLength(0);

        const baseUrl: string = await server.start();

        // `listen` only asks; the socket opens an event later. Being answered is what tells "the port
        // is bound" from "the port was asked for"
        expect((await fetch(`${baseUrl}/listen-host`)).status).toBe(200);
        expect(ticks).toHaveLength(1);
    }, TestTimeouts.inMemory.start);

    it('boots a second application once the first has shut down, with an object graph of its own', async () => {
        server = await bootServer();
        const firstService: LifecycleService = inject(LifecycleService);
        await server.shutdown();

        server = await bootServer();
        // a container that survived would hand the second application services still holding the
        // first's connections, timers and sockets
        expect(inject(LifecycleService)).not.toBe(firstService);
        const baseUrl: string = await server.start();
        expect((await fetch(`${baseUrl}/listen-host`)).status).toBe(200);
    }, TestTimeouts.inMemory.start * 2);
});