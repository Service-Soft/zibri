import { afterAll, beforeAll, describe, it } from '@jest/globals';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';

@Controller('/versioned', { versions: ['1.0.0'] })
class VersionedControllerV1 {
    @Get('/thing')
    get(): { version: string } {
        return { version: 'v1' };
    }
}

@Controller('/versioned', { versions: ['2.0.0'] })
class VersionedControllerV2 {
    @Get('/thing')
    get(): { version: string } {
        return { version: 'v2' };
    }
}

describe('Router — non-overlapping versions on the same route', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [VersionedControllerV1, VersionedControllerV2]
        });
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    it('allows the same route path when versions do not overlap', () => {
        // asserted implicitly: beforeAll's startTestServer must not reject
    });
});