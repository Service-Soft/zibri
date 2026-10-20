import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Controller } from './decorators/controller.decorator.ts';
import { Get } from './decorators/get.decorator.ts';
import { Param } from './decorators/param.decorator.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';

@Controller('/forgot-decorator')
class ForgotDecoratorController {
    @Get('/:id')

    get(
        @Param.path('id', { type: 'string' })
        id: string,
        // this second parameter is intentionally left without a decorator
        // eslint-disable-next-line no-unused-vars
        extra: string
    ): { id: string } {
        return { id };
    }
}

describe('resolveRouteParams — forgotten decorator guard', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [ForgotDecoratorController] });
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns a 500 when a controller method parameter has no resolving decorator', async () => {
        const res: Response = await fetch(`${baseUrl}/forgot-decorator/abc`);
        expect(res.status).toBe(500);
    });
});