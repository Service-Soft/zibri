import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RequestHandler } from 'express';
import { createInMemoryDataSource } from 'zibri-testing';

import { ZibriApplication } from './application';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { HttpMethod } from '../http/http-method.enum';
import { HttpRequest } from '../http/http-request.model';
import { MiddlewarePhase } from '../http/middleware-phase.enum';
import { type RouterInterface } from '../routing/router.interface';

// the order middleware runs in is stated by its phase rather than emerging from the order the calls
// happened in - which for the framework's own middleware was the order the di container built the
// services holding them

/**
 * A middleware that writes down that it ran, in the order the pipeline reached it.
 *
 * A response header rather than anything held on the side, because what is asserted is the order
 * one request went through.
 * @param name - What this one is called in the assertion.
 * @returns The middleware.
 */
function recordPhase(name: string): RequestHandler {
    return (_req, res, next) => {
        const soFar: string | number | string[] | undefined = res.getHeader('x-pipeline');
        res.setHeader('x-pipeline', soFar == undefined ? name : `${String(soFar)},${name}`);
        next();
    };
}

describe('the phases of the middleware pipeline', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });

        // the one window where middleware can be added: the application is initialized, and `start`
        // assembles the pipeline. Registered in the reverse of the order they have to run in, so a
        // passing assertion is the phase deciding and not the call order
        const app: ZibriApplication = server['app'];
        app.use(recordPhase('before-routing'), MiddlewarePhase.BEFORE_ROUTING);
        app.use(recordPhase('security'), MiddlewarePhase.SECURITY);
        app.use(
            (req, res, next) => {
                res.setHeader('x-saw-cookies', String((req as HttpRequest).cookies != undefined));
                next();
            },
            MiddlewarePhase.BEFORE_ROUTING
        );

        baseUrl = await server.start();
        inject<RouterInterface>(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/phases',
            openApi: { useInOpenApi: false },
            handler: () => ({ ok: true })
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('runs a middleware where its phase puts it, not where it was registered', async () => {
        expect((await fetch(`${baseUrl}/phases`)).headers.get('x-pipeline')).toBe('security,before-routing');
    });

    // cookie parsing used to be registered after the `onAppInit` hooks, so a middleware a service
    // registered from there ran ahead of it, and one needing cookies had to know which hook not to use
    it('has parsed the cookies by the time a middleware before routing runs', async () => {
        expect((await fetch(`${baseUrl}/phases`)).headers.get('x-saw-cookies')).toBe('true');
    });

    // accepted, it would be appended behind the handler answering everything unmatched: registered,
    // reachable by nothing, and silent about both
    it('refuses a middleware added after the pipeline was assembled', () => {
        expect(() => server?.['app'].use(recordPhase('too-late'))).toThrow();
    });
});