import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Log } from './log.model';
import { LoggerInterface } from './logger.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpStatus } from '../http/http-status.enum';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Ms } from '../utilities/ms';

/**
 * When the failing handler fails: after the logger's flush interval of a second, so the drain the
 * entries of its request started has written them, and the failure starts a drain of its own.
 */
const FAILS_AFTER_IN_MS: number = 1500;

@Controller('/slow')
class SlowController {
    @Get('/', { timeoutInMs: 50 })
    async slow(): Promise<{ ok: boolean }> {
        await sleep(300);
        return { ok: true };
    }

    @Get('/failing', { timeoutInMs: 50 })
    async failing(): Promise<{ ok: boolean }> {
        // past the drain the request's other entries started, which a later entry would join
        await sleep(FAILS_AFTER_IN_MS);
        throw new Error('the work behind the deadline failed');
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        controllers: [SlowController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// what a request logs is written by whichever drain of the logger's queue it started, and that drain
// ran inside the request: once the request ran out of time, its own data source refused the write,
// so the timeout of a request was never stored
describe('the log of a request that ran out of time', () => {
    it('is stored like any other', async () => {
        // nothing queued, so the request's own entry is what starts the next drain
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();

        const res: Response = await fetch(`${baseUrl}/slow`);
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true });

        expect(logs.map(l => l.message)).toContain('This took longer than the 50ms it is allowed.');
    });

    it('stores what the handler failed with after it ran out of time', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        await logger.flush();

        const res: Response = await fetch(`${baseUrl}/slow/failing`);
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
        // the handler fails a while after the caller was answered, and that is logged inside it. Waited
        // out past the flush interval, so the drain the failure started has run where it was started,
        // rather than being taken over by the flush below
        await sleep(FAILS_AFTER_IN_MS + Ms.SECOND + 500);

        await logger.flush();
        const logs: Log[] = await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true });

        expect(logs.map(l => l.message)).toContain('A request handler failed after its deadline had been answered.');
    });
});
