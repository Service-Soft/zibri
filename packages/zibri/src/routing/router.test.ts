import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Body } from './decorators/body.decorator';
import { Controller } from './decorators/controller.decorator';
import { Delete } from './decorators/delete.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';
import { Post } from './decorators/post.decorator';
import { Put } from './decorators/put.decorator';
import { type RouterInterface } from './router.interface';
import { UndeclaredResultError } from './undeclared-result.error';
import { TestTimeouts } from '../__testing__/constants';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestPlatformPermissions } from '../__testing__/mocks/entities/test-permissions.model';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../auth/authenticators/password/password-credentials.model';
import { Auth } from '../auth/decorators/auth.decorator';
import { HasPermissionMetadata } from '../auth/models/has-permission-metadata.model';
import { ApiKeyAuthStrategy } from '../auth/strategies/api-key/api-key.auth-strategy';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Property } from '../entity/decorators/property.decorator';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { RedirectResponse } from '../http/redirect-response.model';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { Response } from '../open-api/decorators/response.decorator';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';

class Greeting {
    @Property.string()
    message!: string;
}

class Coordinates {
    @Property.number()
    x!: number;

    @Property.number()
    y!: number;
}

class GreetBody {
    @Property.string()
    name!: string;
}

@Controller('/greet')
class GreetController {
    @Post('/')
    create(
        @Body(GreetBody)
        body: GreetBody
    ): Greeting {
        return { message: `hello ${body.name}` };
    }

    @Response.object(Greeting)
    @Get('/mismatch/response')
    mismatchedResponse(): Greeting {
        // deliberately returns a value that violates the declared json-only response type
        return FileResponse.fromStream({
            stream: FsUtilities.createReadStream('/dev/null' as FsPath),
            filename: 'x.txt',
            mimeType: 'text/plain'
        }) as unknown as Greeting;
    }

    @Response.file()
    @Get('/file')
    downloadFile(): FileResponse {
        return FileResponse.fromStream({
            stream: FsUtilities.createReadStream('/dev/null' as FsPath),
            filename: 'greeting.txt',
            mimeType: 'text/plain'
        });
    }

    @Response.html()
    @Get('/page')
    getPage(): HtmlResponse {
        return HtmlResponse.fromString('<h1>hi</h1>');
    }

    @Response.redirect()
    @Get('/redirect')
    redirect(): RedirectResponse {
        return RedirectResponse.to('https://example.com/landing?from=greet');
    }

    // the compiler refuses this declaration as well; the route is here for what the router does
    // with a result its declarations do not cover, which a cast elsewhere could still produce
    // @ts-expect-error -- a redirect is declared, a greeting is returned
    @Response.redirect()
    @Get('/mismatch/redirect')
    mismatchedRedirect(): Greeting {
        return { message: 'not a redirect' };
    }

    // has two path segments, so it never shadows / is shadowed by the single-segment routes below
    @Get('/params/:count/:when')
    params(
        @Param.path('count', { type: 'number' })
        count: number,
        @Param.path('when', { type: 'date' })
        when: Date,
        @Param.query('location', { type: 'object', cls: () => Coordinates })
        location: Coordinates,
        @Param.query('tags', { type: 'array', items: { type: 'string' } })
        tags: string[],
        @Param.query('matrix', { type: 'array', items: { type: 'array', items: { type: 'number' } } })
        matrix: number[][]
    ): { count: number, when: Date, location: Coordinates, tags: string[], matrix: number[][] } {
        return { count, when, location, tags, matrix };
    }

    // registered after the more specific static routes above so it doesn't shadow them
    @Get('/:id')
    byId(
        @Param.path('id', { type: 'string' })
        id: string,
        @Param.query('loud', { type: 'boolean', required: false })
        loud: boolean | undefined,
        @Param.header('x-request-id')
        requestId: string
    ): { id: string, loud: boolean | undefined, requestId: string } {
        return { id, loud, requestId };
    }

    @Put('/:id')
    replace(
        @Param.path('id', { type: 'string' })
        id: string,
        @Body(GreetBody)
        body: GreetBody
    ): Greeting {
        return { message: `${id} is now ${body.name}` };
    }

    @Delete('/:id')
    remove(
        @Param.path('id', { type: 'string' })
        id: string
    ): void {
        void id;
    }
}

class Other {
    @Property.number()
    value!: number;
}

/**
 * One route per way a status can be arrived at.
 *
 * Statuses used to be documentation: a route could declare 201 and answer 200, and the two would
 * never be compared. Every route here declares something different on purpose.
 */
@Controller('/status')
class StatusController {
    @Get('/undeclared-void')
    undeclaredVoid(): void {}

    @Response.empty()
    @Get('/empty-default')
    emptyDefault(): void {}

    @Response.empty({ status: HttpStatus.ACCEPTED })
    @Get('/empty-accepted')
    emptyAccepted(): void {}

    @Response.object(Greeting)
    @Get('/object-default')
    objectDefault(): Greeting {
        return { message: 'hi' };
    }

    @Response.object(Greeting, { status: HttpStatus.CREATED })
    @Get('/object-created')
    objectCreated(): Greeting {
        return { message: 'made' };
    }

    @Response.array(Greeting, { status: HttpStatus.CREATED })
    @Get('/array-created')
    arrayCreated(): Greeting[] {
        return [{ message: 'made' }];
    }

    @Response.file({ status: HttpStatus.CREATED })
    @Get('/file-created')
    fileCreated(): FileResponse {
        return FileResponse.fromStream({
            stream: FsUtilities.createReadStream('/dev/null' as FsPath),
            filename: 'made.txt',
            mimeType: 'text/plain'
        });
    }

    @Response.html({ status: HttpStatus.CREATED })
    @Get('/html-created')
    htmlCreated(): HtmlResponse {
        return HtmlResponse.fromString('<h1>made</h1>');
    }

    @Response.redirect({ status: HttpStatus.TEMPORARY_REDIRECT })
    @Get('/redirect-temporary')
    redirectTemporary(): RedirectResponse {
        return RedirectResponse.to('https://example.com/elsewhere');
    }

    @Response.empty()
    @Response.error(HttpStatus.CONFLICT)
    @Get('/void-with-error')
    voidWithError(): void {}

    @Response.object(Greeting)
    @Response.error(HttpStatus.CONFLICT)
    @Get('/object-with-error')
    objectWithError(): Greeting {
        return { message: 'fine' };
    }

    @Response.object(Greeting, { status: HttpStatus.CREATED })
    @Response.object(Other, { status: HttpStatus.ACCEPTED })
    @Get('/ambiguous')
    ambiguous(): Greeting | Other {
        return { message: 'which one' };
    }

    @Response.empty()
    @Get('/throws')
    throws(): void {
        throw new ConflictError($ts`nope`);
    }
}

@Controller('/route-metadata')
class RouteMetadataController {
    // what the caller of these cases holds, accepted only from a strategy their login is not one of
    @Auth.hasPlatformPermission(TestPlatformPermissions.USER, [ApiKeyAuthStrategy])
    @Get('/keys-only')
    keysOnly(): { ok: boolean } {
        return { ok: true };
    }

    // carries no declaration at all, so anything that appears on it after boot appeared after the
    // route was registered
    @Get('/plain')
    plain(): { ok: boolean } {
        return { ok: true };
    }
}

// an orphan for every case but the last one, which is the only place an application is asked to
// register it
@Controller('/impossible', { allowOrphan: true })
class ImpossibleController {
    // says both "a caller has to be logged in" and "check nothing", which no request could be served under
    @Auth.isLoggedIn()
    @Auth.skip()
    @Get('/both')
    both(): { ok: boolean } {
        return { ok: true };
    }
}

const PASSWORD: string = 'secure123';

/**
 * A json result large enough that serializing it is what the request costs. Many small values
 * rather than a few big ones, because the replacer turning a bigint into a string is a callback V8
 * makes for every key it writes, and the bigint is why that replacer exists.
 */
const largeJsonPayload: { rows: { id: string, name: string, amount: bigint, active: boolean, tags: string[] }[] } = {
    rows: Array.from({ length: 20000 }, (_, i) => ({
        id: `row-${i}`,
        name: `a name that is long enough to be worth writing out ${i}`,
        amount: BigInt(i) * 1000n,
        active: i % 2 === 0,
        tags: ['alpha', 'beta', 'gamma']
    }))
};

/**
 * The large result as the framework writes it.
 */
const largeJsonString: string = JsonUtilities.stringify(largeJsonPayload);

/**
 * How long a route takes to produce the first byte of its answer.
 *
 * A json answer is written in one piece, so its first byte leaves only once it is serialized in full:
 * that puts the whole of the work on this side of the clock and none of the transfer, which costs
 * about what serializing did. The rest is drained, so the connection stays reusable.
 * @param url - The route to ask.
 * @returns The duration in milliseconds.
 */
async function timeToFirstByte(url: string): Promise<number> {
    const start: number = performance.now();
    // no encoding, since an encoder in front of the answer would be a second thing to measure
    const res: globalThis.Response = await fetch(url, { headers: { [KnownHeader.ACCEPT_ENCODING]: 'identity' } });
    if (!res.body) {
        throw new Error(`${url} answered without a body`);
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader();
    await reader.read();
    const duration: number = performance.now() - start;
    let done: boolean = false;
    while (!done) {
        done = (await reader.read()).done;
    }
    return duration;
}

/**
 * How long each route takes to its first byte, the quickest of five. The quickest rather than the
 * average: every request does the same deterministic work, so a slower one only means something else
 * happened. The routes take turns, so a machine that gets busier or quieter meanwhile slows all of
 * them alike.
 * @param urls - The routes to ask.
 * @returns The duration of each in milliseconds, in the order of the routes.
 */
async function resolveFastestRequestsInMs(urls: string[]): Promise<number[]> {
    const durations: number[][] = urls.map(() => []);
    for (let attempt: number = 0; attempt < 5; attempt++) {
        for (const [index, url] of urls.entries()) {
            durations[index]?.push(await timeToFirstByte(url));
        }
    }
    return durations.map(d => Math.min(...d));
}

// one server for every describe below, and every controller on it: a decorated controller that no
// running application registers is an orphan, so a second server booting with only its own would
// fail on the other one before any test ran
let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    // routing reads and writes no rows, so the data source is the in memory one
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        controllers: [GreetController, StatusController, RouteMetadataController, JwtTestAuthController],
        authStrategies: [JwtAuthStrategy]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('Router — HTTP dispatch', () => {

    it('resolves path, query and header params from a real request', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/abc?loud=true`, {
            headers: { 'x-request-id': 'req-1' }
        });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { id: string, loud: boolean, requestId: string } = await res.json();
        expect(body).toEqual({ id: 'abc', loud: true, requestId: 'req-1' });
    });

    it('resolves number/date path params and object/array (incl. nested array) query params from a real request', async () => {
        const when: string = '2024-01-01T00:00:00.000Z';
        const location: Coordinates = { x: 1, y: 2 };
        const tags: string[] = ['a', 'b'];
        const matrix: number[][] = [[1, 2], [3, 4]];
        const query: URLSearchParams = new URLSearchParams({
            location: JsonUtilities.stringify(location),
            tags: JsonUtilities.stringify(tags),
            matrix: JsonUtilities.stringify(matrix)
        });

        const res: Response = await fetch(`${baseUrl}/greet/params/42/${encodeURIComponent(when)}?${query.toString()}`);

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { count: number, when: string, location: Coordinates, tags: string[], matrix: number[][] } = await res.json();
        expect(body).toEqual({ count: 42, when, location, tags, matrix });
    });

    it('reads an array query param given one value per item, and one value as a list of one', async () => {
        const when: string = '2024-01-01T00:00:00.000Z';
        const base: string = `${baseUrl}/greet/params/42/${encodeURIComponent(when)}`
            + `?location=${encodeURIComponent('{"x":1,"y":2}')}&matrix=${encodeURIComponent('[[1]]')}`;

        // the form the published document describes, which a generated client sends
        const several: Response = await fetch(`${base}&tags=a&tags=b`);
        const one: Response = await fetch(`${base}&tags=a`);
        // a value that spells a number is still the text it was sent as
        const numeric: Response = await fetch(`${base}&tags=42`);

        expect(several.status).toBe(200);
        expect(one.status).toBe(200);
        expect(numeric.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const severalBody: { tags: string[] } = await several.json();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const oneBody: { tags: string[] } = await one.json();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const numericBody: { tags: string[] } = await numeric.json();
        expect(severalBody.tags).toEqual(['a', 'b']);
        expect(oneBody.tags).toEqual(['a']);
        expect(numericBody.tags).toEqual(['42']);
    });

    it('rejects a request missing a required header param', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/abc`);
        expect(res.status).toBe(400);
    });

    it('validates and resolves the request body', async () => {
        const res: Response = await fetch(`${baseUrl}/greet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ name: 'Ada' })
        });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: Greeting = await res.json();
        expect(body.message).toBe('hello Ada');
    });

    it('rejects a request body missing a required field', async () => {
        const res: Response = await fetch(`${baseUrl}/greet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({})
        });
        expect(res.status).toBe(400);
    });

    it('returns 404 for an unmatched route with an UnmatchedRouteError body', async () => {
        const res: Response = await fetch(`${baseUrl}/does-not-exist`);
        expect(res.status).toBe(404);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { name: string, message: string } = await res.json();
        expect(body.name).toBe('UnmatchedRouteError');
        expect(body.message).toContain('/does-not-exist');
        expect(body.message).toContain('does not exist');
    });

    it('returns 500 when the handler result violates the declared json-only response type', async () => {
        const logged: jest.Spied<LoggerInterface['error']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

        const res: Response = await fetch(`${baseUrl}/greet/mismatch/response`);

        expect(res.status).toBe(500);
        // what whoever debugs the 500 reads: the route and what it returned. This used to be an
        // "Error initializing router", which sends them looking at startup for a request that failed
        const error: unknown = logged.mock.calls.at(-1)?.[0];
        expect(error).toBeInstanceOf(UndeclaredResultError);
        expect(String(error)).toContain('GreetController.mismatchedResponse returned a FileResponse, but declares only json responses');
        logged.mockRestore();
    });

    it('sends a FileResponse with the correct content-type and disposition headers', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/file`);
        expect(res.status).toBe(200);
        expect(res.headers.get(KnownHeader.CONTENT_DISPOSITION)).toContain('greeting.txt');
    });

    it('sends an HtmlResponse with the correct content-type header', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/page`);
        expect(res.status).toBe(200);
        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toContain('text/html');
        const text: string = await res.text();
        expect(text).toContain('<h1>hi</h1>');
    });

    it('sends a RedirectResponse to its url, with 303 See Other by default', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/redirect`, { redirect: 'manual' });
        expect(res.status).toBe(303);
        expect(res.headers.get(KnownHeader.LOCATION)).toBe('https://example.com/landing?from=greet');
        expect(await res.text()).toBe('');
    });

    it('returns 500 when a route declaring only redirects does not return one', async () => {
        const logged: jest.Spied<LoggerInterface['error']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

        const res: Response = await fetch(`${baseUrl}/greet/mismatch/redirect`, { redirect: 'manual' });

        expect(res.status).toBe(500);
        expect(String(logged.mock.calls.at(-1)?.[0]))
            .toContain('GreetController.mismatchedRedirect declares only redirect responses, but did not return a RedirectResponse');
        logged.mockRestore();
    });

    it('dispatches PUT requests with their path params and body', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/abc`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ name: 'Ada' })
        });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: Greeting = await res.json();
        expect(body.message).toBe('abc is now Ada');
    });

    it('dispatches DELETE requests and returns an empty body', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/abc`, { method: 'DELETE' });
        expect(res.status).toBe(204);
        const text: string = await res.text();
        expect(text).toBe('');
    });
});

describe('Router — response status', () => {

    /**
     * Calls one of the status routes.
     * @param path - The route to call.
     * @returns The status it answered with.
     */
    async function statusOf(path: string): Promise<number> {
        return (await fetch(`${baseUrl}/status${path}`)).status;
    }

    it('answers 204 when a handler returns nothing and declares nothing', async () => {
        expect(await statusOf('/undeclared-void')).toBe(204);
    });

    it('answers 204 for an empty response that names no status', async () => {
        expect(await statusOf('/empty-default')).toBe(204);
    });

    it('answers the status an empty response names', async () => {
        expect(await statusOf('/empty-accepted')).toBe(202);
    });

    it('answers 200 for a value whose response names no status', async () => {
        expect(await statusOf('/object-default')).toBe(200);
    });

    it('answers the status an object response names', async () => {
        expect(await statusOf('/object-created')).toBe(201);
    });

    it('answers the status an array response names', async () => {
        // the value is an array rather than an instance of the declared class, so this only works if
        // the array declaration is matched by shape
        expect(await statusOf('/array-created')).toBe(201);
    });

    it('answers the status a file response names', async () => {
        expect(await statusOf('/file-created')).toBe(201);
    });

    it('answers the status an html response names', async () => {
        expect(await statusOf('/html-created')).toBe(201);
    });

    it('answers the status a redirect response names', async () => {
        const res: Response = await fetch(`${baseUrl}/status/redirect-temporary`, { redirect: 'manual' });
        expect(res.status).toBe(307);
        expect(res.headers.get(KnownHeader.LOCATION)).toBe('https://example.com/elsewhere');
    });

    it('does not take a declared error status for a successful result', async () => {
        // the route declares 409, which describes what it answers when it fails. Answering it on the
        // way out would report a conflict for work that succeeded.
        expect(await statusOf('/void-with-error')).toBe(204);
        expect(await statusOf('/object-with-error')).toBe(200);
    });

    it('leaves the default alone when two declarations could describe the same value', async () => {
        // nothing about the returned object says which of the two it is, and guessing would make the
        // status depend on the order the decorators are written in
        expect(await statusOf('/ambiguous')).toBe(200);
    });

    it('still lets the error handler decide the status when the handler throws', async () => {
        expect(await statusOf('/throws')).toBe(409);
    });
});

describe('Router — the method a request arrived with, and what a path allows', () => {
    // the same answer every time, so the validator express generates is the same on both requests
    beforeAll(() => {
        const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
        // one path under two methods, so that a third is a verb this path does not answer rather than
        // a path that does not exist
        router.registerRoute({ httpMethod: HttpMethod.GET, route: '/methods/thing', openApi: { useInOpenApi: false }, handler: () => ({ read: true }) });
        router.registerRoute({ httpMethod: HttpMethod.POST, route: '/methods/thing', openApi: { useInOpenApi: false }, handler: () => ({ written: true }) });
        router.registerRoute({ httpMethod: HttpMethod.GET, route: '/json/large', openApi: { useInOpenApi: false }, handler: () => largeJsonPayload });
        // the same answer as a string the framework writes as it is, so what a body of this size
        // costs on its way out - the validator, the encoding, the write - is a measurement rather
        // than an allowance
        router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/json/large-written',
            openApi: { useInOpenApi: false },
            handler: () => HtmlResponse.fromString(largeJsonString)
        });
        // the same answer, with the round trip res.json used to make done in the handler: what the
        // framework's one pass is measured against, as a request under the same load
        router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/json/large-three-passes',
            openApi: { useInOpenApi: false },
            handler: () => JsonUtilities.parse(JsonUtilities.stringify(largeJsonPayload))
        });
    });

    // the distinction a 404 cannot draw: this one is worth retrying with another verb, and a route
    // that does not exist never is
    it('answers a path it has with a method it does not with 405, naming the methods that would have worked', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/methods/thing`, { method: 'DELETE' });

        expect(res.status).toBe(405);
        const allow: string = res.headers.get(KnownHeader.ALLOW) ?? '';
        expect(allow).toContain('GET');
        expect(allow).toContain('POST');
        // never declared, and answered all the same: express serves a HEAD from the GET handler
        expect(allow).toContain('HEAD');
        expect(allow).not.toContain('DELETE');
    });

    // the control that keeps the case above about the method rather than about every unmatched
    // request having become a 405
    it('still answers 404 for a path that does not exist, whatever the method', async () => {
        expect((await fetch(`${baseUrl}/methods/nothing-here`, { method: 'DELETE' })).status).toBe(404);
        // only a real preflight is answered by the cors middleware, and only a path the router knows
        // by the one reporting what a path allows
        expect((await fetch(`${baseUrl}/definitely-not-a-route`, { method: 'OPTIONS' })).status).toBe(404);
    });

    // one rule produces both: express generates an Allow of its own for any path some layer matched,
    // and two rules answering one question is how they come to disagree
    it('answers OPTIONS for a path it has with what that path allows, the same list a 405 carries', async () => {
        const options: globalThis.Response = await fetch(`${baseUrl}/methods/thing`, { method: 'OPTIONS' });
        const refused: globalThis.Response = await fetch(`${baseUrl}/methods/thing`, { method: 'DELETE' });

        expect(options.status).toBe(204);
        expect(options.headers.get(KnownHeader.ALLOW) ?? '').toContain('POST');
        expect(options.headers.get(KnownHeader.ALLOW)).toBe(refused.headers.get(KnownHeader.ALLOW));
    });

    // http method names are uppercase and case sensitive, and express compares against literals:
    // `'GET' !== method` is the whole of its freshness check, so a router rewriting the method sent
    // the validator, had it sent back, and downloaded the whole body again on every revalidation
    it('answers a conditional request to a route that set no validator of its own with a 304', async () => {
        const first: globalThis.Response = await fetch(`${baseUrl}/methods/thing`);
        const etag: string | null = first.headers.get(KnownHeader.ETAG);
        await first.arrayBuffer();
        expect(etag).toBeTruthy();

        const second: globalThis.Response = await fetch(`${baseUrl}/methods/thing`, {
            // node's fetch adds `cache-control: no-cache` to any request carrying a conditional
            // header, and a server answering that with 304 would be wrong; a browser revalidating
            // sends this
            headers: { [KnownHeader.IF_NONE_MATCH]: etag ?? '', [KnownHeader.CACHE_CONTROL]: 'max-age=0' }
        });

        expect(second.status).toBe(304);
        expect((await second.text()).length).toBe(0);
    });

    // express decides whether to write the body with `req.method === 'HEAD'`, so a client asking for
    // the size of something got the whole of it
    it('answers a HEAD with the headers of the answer and none of its body', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/methods/thing`, { method: 'HEAD' });

        expect(res.status).toBe(200);
        expect((await res.text()).length).toBe(0);
    });

    // written directly rather than through res.json, which has to keep the content type and the body
    // it used to send - a bigint arriving as a string included, the reason the framework serializes
    // with a replacer of its own
    it('answers a json result with what one pass over it produces', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/json/large`, { headers: { [KnownHeader.ACCEPT_ENCODING]: 'identity' } });

        expect(res.headers.get(KnownHeader.CONTENT_TYPE)).toBe('application/json; charset=utf-8');
        expect(await res.text()).toBe(JsonUtilities.stringify(largeJsonPayload));
    }, 30000);

    // against the other candidates measured here and now, as requests under the same load, so this
    // says something about the framework rather than about the machine: the same string written as
    // it is, and the round trip res.json used to make. Measured in process, the serializing alone
    // was slowed less by a busy machine than a request is, and the comparison read as a regression;
    // measured against an empty answer, what a body of this size costs on its way out - a validator
    // over it, its encoding, the write - counted as serializing, and read as one under load as well
    it('costs one serializing pass over a json result rather than three', async () => {
        // warmed first, or the measured request pays for compiling everything on the way
        for (const route of ['/json/large-written', '/json/large', '/json/large-three-passes']) {
            await timeToFirstByte(`${baseUrl}${route}`);
        }

        const [written = 0, onePass = 0, threePasses = 0] = await resolveFastestRequestsInMs(
            ['/json/large-written', '/json/large', '/json/large-three-passes'].map(route => `${baseUrl}${route}`)
        );

        // all three write the same body, so what the json route adds over the written one is its
        // serializing, and what the third adds over the json one is the round trip alone, whatever
        // the router does: a stringify and a parse, a bar the router cannot move. One pass stays
        // under it and three go over it. A ratio could not tell them apart, since a router writing
        // three times adds the same to both.
        // with the three timings, so that a run that fails says what each request cost
        expect({ written, onePass, threePasses, onePassUnderTwo: onePass - written < threePasses - onePass })
            .toEqual({ written, onePass, threePasses, onePassUnderTwo: true });
    }, 60000);
});

// what a route declared is decided when its module loads, so it is read once, when the route is
// registered: reading it per request cost a copy each time, and caught a declaration nothing can
// satisfy only on whoever called the route first
describe('Router — what a route declares', () => {
    let accessToken: string;

    beforeAll(async () => {
        // logged in through a strategy the route does not accept, the one vantage point from which a
        // widened set of strategies is visible
        const email: string = 'route-metadata@example.com';
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: PASSWORD, userId: user.id });
        const res: globalThis.Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ email, password: PASSWORD })
        });
        accessToken = (await res.json() as { accessToken: { value: string } }).accessToken.value;
    });

    it('refuses a caller logged in through a strategy the route does not accept', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/route-metadata/keys-only`, { headers: { authorization: `Bearer ${accessToken}` } });

        expect(res.status).toBe(403);
    });

    it('does not hand out the route\'s own declaration by reference', async () => {
        const handedOut: HasPermissionMetadata | undefined = MetadataUtilities.getRouteHasPlatformPermission(RouteMetadataController, 'keysOnly');
        expect(handedOut?.allowedStrategies).toEqual([ApiKeyAuthStrategy]);

        handedOut?.allowedStrategies?.push(JwtAuthStrategy);

        // a shallow copy hands out the route's own array, and writing to it rewrites what the route accepts
        expect(MetadataUtilities.getRouteHasPlatformPermission(RouteMetadataController, 'keysOnly')?.allowedStrategies)
            .toEqual([ApiKeyAuthStrategy]);
        const res: globalThis.Response = await fetch(`${baseUrl}/route-metadata/keys-only`, { headers: { authorization: `Bearer ${accessToken}` } });
        expect(res.status).toBe(403);
    });

    it('does not read the declaration again while serving a request', async () => {
        expect((await fetch(`${baseUrl}/route-metadata/plain`)).status).toBe(200);

        // a login requirement that did not exist when the route was registered. Nothing legitimate
        // writes one after boot, so this asks "is the declaration still read" the only way a caller can
        MetadataUtilities.setRouteIsLoggedIn(RouteMetadataController, { allowedStrategies: undefined }, 'plain');

        expect((await fetch(`${baseUrl}/route-metadata/plain`)).status).toBe(200);
    });

    // last in the file: it replaces the running application with one that refuses to start
    it('refuses an impossible declaration while registering the route, not while serving it', async () => {
        await expect(server.reInit({ controllers: [ImpossibleController] })).rejects.toThrow(InvalidDecoratorCombinationError);
    }, TestTimeouts.inMemory.start);
});