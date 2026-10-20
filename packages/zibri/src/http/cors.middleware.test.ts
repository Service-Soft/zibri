import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CorsOrigin, corsMiddleware } from './cors.middleware.ts';
import { KnownHeader } from './known-header.enum.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';

/**
 * Cors decides what a browser lets one origin do with a user's credentials, so what is worth
 * asserting is the headers that come back over http rather than that a function called setHeader.
 * These go through a real server for that reason.
 *
 * Executable form of evaluation/02-http-runtime-core.md C1.
 */

const allowedOrigin: CorsOrigin = 'https://app.example.com';

@Controller('/cors-test')
class CorsTestController {
    /**
     * Something for the preflights to be about.
     * @returns Anything at all - no assertion here reads the body.
     */
    @Get('/')
    read(): string {
        return 'ok';
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        controllers: [CorsTestController],
        security: { cors: { origins: [allowedOrigin], credentials: true } }
    });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

describe('corsMiddleware', () => {

    it('answers a preflight from an allowed origin with the methods and headers it needs', async () => {
        const res: Response = await fetch(`${baseUrl}/cors-test`, {
            method: 'OPTIONS',
            headers: { [KnownHeader.ORIGIN]: allowedOrigin, [KnownHeader.ACCESS_CONTROL_REQUEST_METHOD]: 'PATCH' }
        });

        expect(res.status).toBe(200);
        expect(res.headers.get(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN)).toBe(allowedOrigin);
        expect(res.headers.get(KnownHeader.ACCESS_CONTROL_ALLOW_CREDENTIALS)).toBe('true');

        // PATCH was missing from the hardcoded list, so every browser PATCH preflight failed against
        // a framework that ships a @Patch decorator
        expect(res.headers.get(KnownHeader.ACCESS_CONTROL_ALLOW_METHODS)).toContain('PATCH');

        // the framework's own headers, which the hardcoded list left out - a browser client could not
        // send the csrf token, the two factor code or its trace context, so those features were
        // unusable cross origin. The two auth ones are taken from the di tokens that name them, so
        // renaming one cannot leave this behind.
        const allowedHeaders: string = res.headers.get(KnownHeader.ACCESS_CONTROL_ALLOW_HEADERS) ?? '';
        expect(allowedHeaders).toContain('x-csrf-token');
        expect(allowedHeaders).toContain('x-authorization-otp');
        expect(allowedHeaders).toContain(KnownHeader.TRACEPARENT);
        expect(allowedHeaders).toContain(KnownHeader.TRACESTATE);
        expect(allowedHeaders).toContain(KnownHeader.DPOP);

        // being allowed to send a header is not being allowed to read one back. Nothing was exposed
        // at all, so a page could not see the csrf token the framework reissues when a session
        // rotates, and would keep sending the one that had just been retired. The trace one is what
        // lets a page report which trace answered it.
        const exposedHeaders: string = res.headers.get(KnownHeader.ACCESS_CONTROL_EXPOSE_HEADERS) ?? '';
        expect(exposedHeaders).toContain('x-csrf-token');
        expect(exposedHeaders).toContain(KnownHeader.TRACERESPONSE);
        expect(exposedHeaders).toContain(KnownHeader.DPOP_NONCE);
    });

    it('does not tell a browser that an unlisted origin may read the response', async () => {
        const res: Response = await fetch(`${baseUrl}/cors-test`, {
            method: 'OPTIONS',
            headers: { [KnownHeader.ORIGIN]: 'https://evil.example.com', [KnownHeader.ACCESS_CONTROL_REQUEST_METHOD]: 'GET' }
        });

        // absent rather than wrong: the browser then refuses to hand the response to the page, which
        // is the entire mechanism. The `*` this used to send handed it over instead
        expect(res.headers.get(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN)).toBeNull();
    });

    it('varies on origin, so a shared cache cannot serve one origin the answer given to another', async () => {
        const res: Response = await fetch(`${baseUrl}/cors-test`, {
            method: 'OPTIONS',
            headers: { [KnownHeader.ORIGIN]: allowedOrigin, [KnownHeader.ACCESS_CONTROL_REQUEST_METHOD]: 'GET' }
        });

        expect(res.headers.get(KnownHeader.VARY)?.toLowerCase()).toContain('origin');
    });

    it('lets an OPTIONS request that is not a preflight reach the router', async () => {
        // a browser preflight always carries access-control-request-method, so this is not one - it
        // is curl, a probe, or a client asking what the endpoint supports.
        const res: Response = await fetch(`${baseUrl}/cors-test`, { method: 'OPTIONS' });

        // the allow header is what proves it got past the middleware: cors never sets one, and this
        // is express answering the question OPTIONS actually asks. Short circuiting every OPTIONS
        // suppressed that for every path in the app, replacing a real answer with a blank 200.
        expect(res.headers.get(KnownHeader.ALLOW)).toContain('GET');
    });

    it('refuses credentials together with every origin, which no browser would honor', () => {
        // not a preference: a wildcard origin cannot carry credentials, so accepting this would look
        // like the loosest possible setting while silently disabling cookie auth from a browser
        expect(() => corsMiddleware({ origins: '*', credentials: true })).toThrow('browsers refuse');
    });
});