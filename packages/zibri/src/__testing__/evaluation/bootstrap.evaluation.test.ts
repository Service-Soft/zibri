import { Server } from 'node:http';

import { describe, expect, it } from '@jest/globals';

import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { CronService } from '../../cron/cron.service';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { LogLevel } from '../../logging/log-level.enum';
import { Log } from '../../logging/log.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { createTestDataSource, defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Every tick this job has run, so that "did scheduled work happen yet" is a question about
 * observable behavior rather than about internal state.
 */
const ticks: number[] = [];

/**
 * An ordinary application service, registered the way any consumer's would be.
 *
 * Which application an injected service belongs to is not otherwise observable: two applications
 * sharing a container are handed the identical object and nothing says so. Object identity is what
 * turns that into an assertion.
 */
@Injectable()
class EvalLifecycleService {}

/**
 * A job that fires as soon as it is scheduled.
 *
 * `runOnInit` is what makes this observable at all: it turns "the job was scheduled" into "the job
 * ran", so the timing can be read off an array rather than out of internal state. Not distributed and
 * not synced to a data source, because neither coordination nor persistence is what is being tested
 * here - only when it happens.
 */
class EvalStartupCronJob extends CronJob {
    initialConfig: InitialCronConfig = {
        name: 'evaluation startup marker',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: true,
        distributed: false,
        syncToDataSource: false
    };

    onTick(): void {
        ticks.push(Date.now());
    }
}

/**
 * Bootstrap findings from evaluation/01-data-layer.md (C1),
 * evaluation/02-http-runtime-core.md (C5, C7), evaluation/04-infrastructure-subsystems.md (1.3b) and
 * evaluation/05-di-metadata-and-packaging.md (D10).
 *
 * Every `createTestDataSource` here says `allowOrphan: true`, which no other suite needs: this is the
 * one file that builds a data source per test and hands each application only the newest of them, so
 * all the earlier ones are declared and never deployed. That is 05 D10's shared-module case occurring
 * naturally, in the framework's own repository.
 *
 * These live in their own file because they need a freshly booted application of their own, and an
 * application holds the process while it runs - a second one built before the first has shut down is
 * refused, which is 02 C7 below. Jest gives every test file its own module registry, so one server
 * per test here is safe as long as each is shut down in a `finally`.
 *
 * Every expectation describes the fixed behavior, so this file is red until the corresponding
 * finding is closed. See ./README.md for why.
 */

describe('evaluation - application bootstrap', () => {

    // 01 C1 (schema management must be stated) lives in ./schema-management.evaluation.test.ts. It
    // has to declare a data source of its own, and a second stray @DataSource in this file would
    // poison every test after it for the same reason D10 below does.

    describe('02 C5 - listen errors must reach the caller', () => {
        it('rejects start() when the port is already taken', async () => {
            const blocker: Server = new Server();
            await new Promise<void>(resolve => blocker.listen(0, resolve));
            const address: ReturnType<Server['address']> = blocker.address();
            if (address == undefined || typeof address === 'string') {
                throw new Error('could not resolve the blocked port');
            }

            const server: StartedTestServer = await startTestServer({ dataSources: [createTestDataSource({ allowOrphan: true })] });
            try {
                // a bind failure is announced on the server an event after listen() was called, so
                // without something waiting for it start() resolves, logs "<app> is running on port
                // <port>", and only then does the process die - and the caller never gets to handle
                // the one startup failure it is most likely to hit
                await expect(server['app'].start(address.port)).rejects.toThrow();
            }
            finally {
                await server.shutdown();
                await new Promise<void>(resolve => blocker.close(() => resolve()));
            }
        }, 90000);

        it('survives an error the server emits once it is listening', async () => {
            const server: StartedTestServer = await startTestServer({ dataSources: [createTestDataSource({ allowOrphan: true })] });
            try {
                const baseUrl: string = await server.start();

                // emitted rather than provoked, because the real trigger cannot be staged: node
                // raises this when accept() fails, which needs the process to be out of file
                // descriptors. The event is the same one either way, and an 'error' with no listener
                // is thrown by emit itself - which is why a bind the caller can catch says nothing
                // about the rest of the server's life.
                expect(() => server['app'].server.emit('error', new Error('accept EMFILE')))
                    .not.toThrow();

                // and the connections that were already open are unaffected, which is why ending the
                // process here would be the wrong answer to a moment of pressure
                const res: Response = await fetch(`${baseUrl}/does-not-exist`);
                expect(res.status).toBe(404);

                await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
                const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({ where: { level: LogLevel.ERROR } });
                expect(logs.some(l => l.context.error?.paragraphs.some(p => p.includes('accept EMFILE')) === true)).toBe(true);
            }
            finally {
                await server.shutdown();
            }
        }, 90000);
    });

    describe('04 1.3b - scheduled work must not start before the app is listening', () => {
        it('does not run a job until the http server is listening', async () => {
            ticks.length = 0;

            // the shared providers replace CRON_SERVICE with an inert stub, so the real one has to
            // be put back or there is no scheduling to observe the timing of
            const server: StartedTestServer = await startTestServer({
                dataSources: [createTestDataSource({ allowOrphan: true })],
                providers: [
                    ...defaultTestServerProviders,
                    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
                ],
                cronJobs: [EvalStartupCronJob]
            });

            try {
                // registration happens in afterAppInit, because it reads and writes the data source.
                // Firing does not: startTestServer only calls init(), and nothing is listening yet,
                // so no readiness probe could have passed and no operator could have aborted the
                // deploy. A pod that never becomes ready must not have run the nightly job.
                expect(ticks).toHaveLength(0);

                await server.start();

                // and once the port is bound it is a pod somebody can reach, so the work begins
                expect(ticks).toHaveLength(1);
            }
            finally {
                await server.shutdown();
            }
        }, 90000);

        it('is listening by the time the work starts, not merely asked to listen', async () => {
            ticks.length = 0;

            const server: StartedTestServer = await startTestServer({
                dataSources: [createTestDataSource({ allowOrphan: true })],
                providers: [
                    ...defaultTestServerProviders,
                    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
                ],
                cronJobs: [EvalStartupCronJob]
            });

            try {
                const baseUrl: string = await server.start();

                // `listen` only asks; the socket opens an event later. Answering a request is what
                // separates "the port is bound" from "the port was requested", which is the whole
                // difference the hook is there to make - the status does not matter, being answered
                // at all does
                const res: Response = await fetch(`${baseUrl}/does-not-exist`);
                expect(res.status).toBeGreaterThan(0);
                expect(ticks).toHaveLength(1);
            }
            finally {
                await server.shutdown();
            }
        }, 90000);
    });

    describe('02 C7 - an application must be able to follow another in one process', () => {
        it('boots a second application once the first has shut down', async () => {
            // one declared data source used by both, which is what a consumer has: the class is
            // declared once at module level and the application lifetime around it is what repeats
            const dataSource: Newable<PostgresDataSource> = createTestDataSource({ allowOrphan: true });

            const first: StartedTestServer = await startTestServer({ dataSources: [dataSource] });
            const firstService: EvalLifecycleService = inject(EvalLifecycleService);
            await first.shutdown();

            // today this throws before it does anything: shutdown leaves the app reading as
            // SHUTTING_DOWN and there is no transition out of it, so markAppAsCreated refuses. The
            // framework's own harness only gets away with it by assigning to a private static
            const second: StartedTestServer = await startTestServer({ dataSources: [dataSource] });
            try {
                // a fresh object graph rather than the first application's. Providers are re-registered
                // on every init, but registering never evicts a cached instance - so a container that
                // survived would hand the second application services still holding the first's
                // connections, timers and sockets
                expect(inject(EvalLifecycleService)).not.toBe(firstService);

                const url: string = await second.start();
                const response: Response = await fetch(`${url}/no-such-route`);

                // routed and answered by this application's own error handler, so the http stack came
                // up rather than merely the object graph
                expect(response.status).toBe(404);
            }
            finally {
                await second.shutdown();
            }
        }, 120000);
    });

    // Kept last on purpose, and its two cases are in the order they are for the same reason.
    // @DataSource registers into the static GlobalRegistry at decoration time and nothing takes it
    // back out, so a class declared in one test is visible to every test after it. The second case
    // deliberately declares one that is *not* allowed to be an orphan, which means nothing may boot
    // an application after it - so it goes last, in the file's last describe.
    describe('05 D10 - defining a data source must not fail an app that does not use it', () => {
        it('boots with a decorated data source the application options never mention', async () => {
            @DataSource({ allowOrphan: true })
            class EvalUnusedDataSource extends PostgresDataSource {

                override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
                    host: 'localhost',
                    username: 'postgres',
                    password: 'password',
                    database: 'db'
                };

                entities: Newable<BaseEntity>[] = defaultTestServerEntities;

                schemaManagement: SchemaManagement = 'synchronize';
            }

            // never passed to the application, and never used - it only exists. A shared module
            // that exports a data source factory alongside anything else does exactly this to every
            // app that imports it for the unrelated export.
            expect(EvalUnusedDataSource).toBeDefined();

            const server: StartedTestServer = await startTestServer({ dataSources: [createTestDataSource({ allowOrphan: true })] });
            await server.shutdown();
        }, 90000);

        it('still refuses to boot when a data source is declared without saying it may go unused', async () => {
            @DataSource()
            class EvalForgottenDataSource extends PostgresDataSource {

                override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
                    host: 'localhost',
                    username: 'postgres',
                    password: 'password',
                    database: 'db'
                };

                entities: Newable<BaseEntity>[] = defaultTestServerEntities;

                schemaManagement: SchemaManagement = 'synchronize';
            }

            expect(EvalForgottenDataSource).toBeDefined();

            // the half of the validation worth keeping, and why this closed with a flag rather than
            // by deleting the check: a data source the application meant to use and forgot to list
            // connects to nothing, and the first query is where anybody finds out
            await expect(startTestServer({ dataSources: [createTestDataSource({ allowOrphan: true })] }))
                .rejects.toThrow(/EvalForgottenDataSource/);
        }, 90000);
    });
});