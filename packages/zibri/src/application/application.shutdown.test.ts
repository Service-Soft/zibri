import { afterEach, beforeEach, describe, expect, it, vi, MockInstance } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { type OnAppShutdown } from '../global/on-app-shutdown.interface.ts';

/**
 * How an application ends, and what that tells whatever started the process.
 *
 * `process.exit` is the one thing stubbed, because it is the boundary a test cannot cross and keep
 * running. Everything up to it is the real shutdown of a real application.
 */

/**
 * Whether the hook below fails, set per case.
 *
 * One service shared by every case rather than a failing one declared for a single case: a class
 * with a lifecycle hook is built by any application it is registered in, so declaring it once is the
 * only way to keep it out of the cases that want a clean shutdown.
 */
let failShutdown: boolean = false;

@Injectable()
class ShutdownProbe implements OnAppShutdown {
    onAppShutdown(): void {
        if (failShutdown) {
            throw new Error('the teardown of this service failed');
        }
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

/**
 * The stubbed `process.exit`.
 */
type ProcessExitSpy = MockInstance<typeof process.exit>;

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

    beforeEach(async () => {
        failShutdown = false;
        // a mock with no implementation returns nothing, which is what lets the shutdown carry on
        // past the exit the way a test needs it to
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(vi.fn<typeof process.exit>());
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: defaultTestServerProviders,
            additionalLifecycleServices: [ShutdownProbe]
        });
        await server.start();
    }, 15000);

    afterEach(async () => {
        // a no-op for the cases that already shut it down through a signal
        await server.shutdown();
        exitSpy.mockRestore();
    }, 15000);

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
});