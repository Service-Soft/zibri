import { Readable } from 'node:stream';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator.ts';
import { Get } from './decorators/get.decorator.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { WriteThroughReadThroughCache } from '../caching/cache/read-through/write-through-read-through.cache.ts';
import { type CacheServiceInterface } from '../caching/cache-service.interface.ts';
import { Cache } from '../caching/decorators/cache.decorator.ts';
import { Cached } from '../caching/decorators/cached.decorator.ts';
import { InMemoryCacheStore } from '../caching/store/in-memory.cache-store.ts';
import { HttpRequestContext } from '../context/request/http-request.context.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model.ts';
import { WebsocketRequestContext } from '../context/request/websocket-request.context.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider, DiProvider } from '../di/models/di-provider.model.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { type LoggerInterface } from '../logging/logger.interface.ts';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface.ts';
import { Response } from '../open-api/decorators/response.decorator.ts';
import { FileResponse } from '../parsing/form-data/file-response.model.ts';
import { CspOptionsInput } from '../parsing/html/csp-options.model.ts';
import { HtmlResponse } from '../parsing/html/html-response.model.ts';

/**
 * Holds rendered pages the way the caching documentation does it: in process, handing back the very
 * object it was given.
 */
@Cache()
class CspPageCache extends WriteThroughReadThroughCache<string, HtmlResponse, 'CspPageCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('CspPageCache', new InMemoryCacheStore(), []);
    }
}

/**
 * A page with an inline script, allowed to run by the request's nonce - the way a template reads it.
 * @returns The html.
 */
function pageWithScript(): string {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    return `<html><body><script nonce="${context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE)}">1</script></body></html>`;
}

@Controller('/csp')
class CspController {
    @Response.html()
    @Get('/page')
    page(): HtmlResponse {
        return HtmlResponse.fromString(pageWithScript());
    }

    @Cached(CspPageCache, () => 'page')
    @Response.html()
    @Get('/cached')
    // eslint-disable-next-line typescript/require-await
    async cached(): Promise<HtmlResponse> {
        return HtmlResponse.fromString(pageWithScript());
    }

    @Response.html()
    @Get('/own-script-src')
    ownScriptSrc(): HtmlResponse {
        return HtmlResponse.fromString(pageWithScript(), { csp: { scriptSrc: ['https://cdn.example.com'] } });
    }

    @Response.html()
    @Get('/unsafe-inline')
    unsafeInline(): HtmlResponse {
        return HtmlResponse.fromString(pageWithScript(), { csp: { scriptSrc: ['\'self\'', '\'unsafe-inline\''] } });
    }

    @Response.html()
    @Get('/no-csp')
    noCsp(): HtmlResponse {
        return HtmlResponse.fromString(pageWithScript(), { csp: false });
    }

    @Response.file()
    @Get('/icon')
    icon(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from(['<svg xmlns="http://www.w3.org/2000/svg"/>']), filename: 'icon.svg' });
    }

    @Response.file()
    @Get('/notes')
    notes(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from(['notes']), filename: 'notes.txt' });
    }

    @Response.file()
    @Get('/notes-with-csp')
    notesWithCsp(): FileResponse {
        return FileResponse.fromStream({ stream: Readable.from(['notes']), filename: 'notes.txt', csp: true });
    }
}

/**
 * What the application declares for every response, on top of the framework's defaults.
 */
const applicationCsp: CspOptionsInput = {
    imgSrc: ['https://img.example.com']
};

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS_INPUT, useValue: applicationCsp })
];

/**
 * A content security policy, by directive.
 * @param response - The response carrying it.
 * @returns Each directive's sources.
 */
function directivesOf(response: globalThis.Response): Map<string, string[]> {
    const header: string = response.headers.get(KnownHeader.CONTENT_SECURITY_POLICY) ?? '';
    const directives: string[] = header.split(';')
        .map(d => d.trim())
        .filter(Boolean);
    return new Map(directives.map(d => {
        const [name = '', ...sources] = d.split(' ');
        return [name, sources];
    }));
}

/**
 * The nonce a body's script tag carries.
 * @param body - The html.
 * @returns The nonce, or undefined for a script without one.
 */
function scriptNonceOf(body: string): string | undefined {
    return /<script nonce="([^"]+)"/.exec(body)?.[1];
}

describe('the content security policy a response is written with', () => {
    let server: StartedTestServer | undefined;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [CspController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            providers
        });
        baseUrl = await server.start();
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('allows the page\'s own script by the nonce its body carries', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/csp/page`);
        const nonce: string | undefined = scriptNonceOf(await res.text());
        const directives: Map<string, string[]> = directivesOf(res);

        expect(nonce).toBeDefined();
        expect(directives.get('script-src')).toStrictEqual(['\'self\'', `'nonce-${nonce}'`]);
        expect(directives.get('default-src')).toStrictEqual(['\'self\'']);
        expect(directives.get('frame-ancestors')).toStrictEqual(['\'self\'']);
        // cspell:disable-next-line
        expect(res.headers.get(KnownHeader.X_FRAME_OPTIONS)).toBe('SAMEORIGIN');
    });

    it('adds what the application declares to every response', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/csp/page`);

        expect(directivesOf(res).get('img-src')).toStrictEqual(['https://img.example.com']);
        // a directive the application leaves alone keeps the framework's value
        expect(directivesOf(res).get('object-src')).toStrictEqual(['\'none\'']);
    });

    it('gives every response a nonce of its own', async () => {
        const first: string | undefined = scriptNonceOf(await (await fetch(`${baseUrl}/csp/page`)).text());
        const second: string | undefined = scriptNonceOf(await (await fetch(`${baseUrl}/csp/page`)).text());

        expect(first).toBeDefined();
        expect(first).not.toBe(second);
    });

    it('gives a cached page a nonce of its own, in the header and in the body alike', async () => {
        const first: globalThis.Response = await fetch(`${baseUrl}/csp/cached`);
        const firstNonce: string | undefined = scriptNonceOf(await first.text());
        const second: globalThis.Response = await fetch(`${baseUrl}/csp/cached`);
        const secondNonce: string | undefined = scriptNonceOf(await second.text());

        // the second one came out of the cache: the same body, rendered once
        expect(firstNonce).toBeDefined();
        expect(secondNonce).not.toBe(firstNonce);
        expect(directivesOf(second).get('script-src')).toContain(`'nonce-${secondNonce}'`);
    });

    it('lets a response replace a directive, and keeps the nonce in it', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/csp/own-script-src`);
        const nonce: string | undefined = scriptNonceOf(await res.text());

        expect(directivesOf(res).get('script-src')).toStrictEqual(['https://cdn.example.com', `'nonce-${nonce}'`]);
        expect(directivesOf(res).get('default-src')).toStrictEqual(['\'self\'']);
    });

    it('leaves a script-src that allows every inline script as it was declared', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/csp/unsafe-inline`);

        // a browser that finds a nonce in script-src ignores 'unsafe-inline' there, so adding one
        // would forbid the very scripts this response allows - its own script is allowed already
        expect(directivesOf(res).get('script-src')).toStrictEqual(['\'self\'', '\'unsafe-inline\'']);
    });

    it('sends no policy for a response that turns it off', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/csp/no-csp`);

        expect(res.headers.get(KnownHeader.CONTENT_SECURITY_POLICY)).toBeNull();
        expect(res.headers.get(KnownHeader.X_FRAME_OPTIONS)).toBeNull();
    });

    it('sends a policy with an svg, which a browser renders, and none with other files', async () => {
        const icon: globalThis.Response = await fetch(`${baseUrl}/csp/icon`);
        const notes: globalThis.Response = await fetch(`${baseUrl}/csp/notes`);

        expect(directivesOf(icon).get('default-src')).toStrictEqual(['\'self\'']);
        expect(notes.headers.get(KnownHeader.CONTENT_SECURITY_POLICY)).toBeNull();
    });

    it('warns about a policy on a file no browser renders, and not about one on an svg', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const warn: MockInstance<LoggerInterface['warn']> = vi.spyOn(logger, 'warn');

        await (await fetch(`${baseUrl}/csp/icon`)).text();
        expect(warn).not.toHaveBeenCalled();

        const notes: globalThis.Response = await fetch(`${baseUrl}/csp/notes-with-csp`);
        await notes.text();
        expect(notes.headers.get(KnownHeader.CONTENT_SECURITY_POLICY)).not.toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not of type svg'));
    });
});