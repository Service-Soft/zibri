import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider } from '../di/models/di-provider.model';
import { type AfterAppShutdown } from '../global/after-app-shutdown.interface';
import { type OnAppShutdown } from '../global/on-app-shutdown.interface';
import { LogLevel } from '../logging/log-level.enum';
import { Log } from '../logging/log.model';
import { BaseLoggerTransportConfig, LoggerTransport } from '../logging/transport/logger-transport.model';

/**
 * How an application ends, and what that tells whatever started the process.
 *
 * `process.exit` is the one thing stubbed, because it is the boundary a test cannot cross and keep
 * running. Everything up to it is the real shutdown of a real application.
 */

/**
 * Whether the hooks below fail, set per case.
 *
 * One service shared by every case rather than a failing one declared for a single case: a class
 * with a lifecycle hook is built by any application it is registered in, so declaring it once is the
 * only way to keep it out of the cases that want a clean shutdown.
 */
let failShutdown: boolean = false;
let failAfterShutdown: boolean = false;

@Injectable()
class ShutdownProbe implements OnAppShutdown {
    onAppShutdown(): void {
        if (failShutdown) {
            throw new Error('the teardown of this service failed');
        }
    }
}

@Injectable()
class AfterShutdownProbe implements AfterAppShutdown {
    afterAppShutdown(): void {
        if (failAfterShutdown) {
            throw new Error('the late teardown of this service failed');
        }
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * The stubbed `process.exit`.
 */
type ProcessExitSpy = jest.Spied<typeof process.exit>;

/**
 * Waits until the application has asked to end the process.
 *
 * A signal handler starts the shutdown without handing anybody its promise, so asking whether it
 * reached the exit is the only way to know it finished.
 * @param exitSpy - The stubbed `process.exit`.
 */
async function waitForExit(exitSpy: ProcessExitSpy): Promise<void> {
    const deadline: number = Date.now() + 10000;
    while (!exitSpy.mock.calls.length) {
        if (Date.now() > deadline) {
            throw new Error('the application never asked to end the process');
        }
        await new Promise<void>(resolve => {
            setTimeout(resolve, 10);
        });
    }
}

describe('shutting an application down', () => {
    let server: StartedTestServer;
    let exitSpy: ProcessExitSpy;
    // the messages each transport was handed, as they stood when the process was asked to end: an
    // entry written afterwards is one nobody reads
    let writtenDirectly: string[] = [];
    let writtenAfterStartup: string[] = [];
    let directlyAtExit: string[] = [];
    let afterStartupAtExit: string[] = [];
    let listenersBefore: NodeJS.UncaughtExceptionListener[] = [];

    beforeEach(async () => {
        failShutdown = false;
        failAfterShutdown = false;
        writtenDirectly = [];
        writtenAfterStartup = [];
        // a mock with no implementation returns nothing, which is what lets the shutdown carry on
        // past the exit the way a test needs it to
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
            directlyAtExit = [...writtenDirectly];
            afterStartupAtExit = [...writtenAfterStartup];
            return undefined as never;
        });
        listenersBefore = process.listeners('uncaughtException');
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS,
                    useFactory: () => [
                        LoggerTransport.create<BaseLoggerTransportConfig>(
                            { name: 'Directly', level: LogLevel.INFO, register: 'directly' },
                            (logs: Log[]) => {
                                writtenDirectly.push(...logs.map(log => log.message));
                            }
                        ),
                        // what the db transport is: one that writes to a data source
                        LoggerTransport.create<BaseLoggerTransportConfig>(
                            { name: 'AfterStartup', level: LogLevel.INFO, register: 'afterStartup' },
                            (logs: Log[]) => {
                                writtenAfterStartup.push(...logs.map(log => log.message));
                            }
                        )
                    ]
                })
            ],
            additionalLifecycleServices: [ShutdownProbe, AfterShutdownProbe]
        });
        await server.start();
    }, TestTimeouts.inMemory.start);

    afterEach(async () => {
        // a no-op for the cases that already shut it down through a signal
        await server.shutdown();
        exitSpy.mockRestore();
    }, TestTimeouts.inMemory.shutdown);

    it('leaves the process running when the application is shut down by a call', async () => {
        await server.shutdown();

        // a test, a script or a host embedding several applications ends one of them this way, and
        // ending the whole process with it is not something any of them asked for
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('ends the process with 0 when it is shut down by a signal and every teardown worked', async () => {
        process.emit('SIGTERM');
        await waitForExit(exitSpy);

        expect(exitSpy.mock.calls).toEqual([[0]]);
    });

    it('ends the process with 1 when it is shut down by a signal and a teardown failed', async () => {
        failShutdown = true;

        process.emit('SIGTERM');
        await waitForExit(exitSpy);

        // each hook swallows its own error so the others still run, and the exit code is where the
        // failure goes instead. It used to be 0 regardless, so an orchestrator read a clean exit and
        // a rolling deploy carried on as though the teardown had gone fine
        expect(exitSpy.mock.calls).toEqual([[1]]);
    });

    it('writes what a teardown logged to every transport before the process ends', async () => {
        failShutdown = true;

        process.emit('SIGTERM');
        await waitForExit(exitSpy);

        // the data sources are still open after the phase the hook ran in, so the transport that
        // writes to one gets the entry as well
        expect(directlyAtExit).toContain('the teardown of this service failed');
        expect(afterStartupAtExit).toContain('the teardown of this service failed');
    });

    it('writes what the last phase logged to the transports that need no data source before the process ends', async () => {
        failAfterShutdown = true;

        process.emit('SIGTERM');
        await waitForExit(exitSpy);

        expect(exitSpy.mock.calls).toEqual([[1]]);
        expect(directlyAtExit).toContain('the late teardown of this service failed');
        // the data sources closed in that phase, so the transport writing to one has nowhere to write
        expect(afterStartupAtExit).not.toContain('the late teardown of this service failed');
    });

    it('writes an uncaught exception before the process ends on it', async () => {
        const [handler] = process.listeners('uncaughtException').filter(listener => !listenersBefore.includes(listener));
        if (handler == undefined) {
            throw new Error('the application registered no uncaught exception listener');
        }

        // called rather than emitted, which would hand the error to the test runner's listener too
        handler(new Error('boom'), 'uncaughtException');
        await waitForExit(exitSpy);

        expect(exitSpy.mock.calls).toEqual([[1]]);
        expect(directlyAtExit).toContain('Uncaught exception');
        expect(afterStartupAtExit).toContain('Uncaught exception');
    });
});