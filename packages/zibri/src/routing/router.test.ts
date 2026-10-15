import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Body } from './decorators/body.decorator';
import { Controller } from './decorators/controller.decorator';
import { Delete } from './decorators/delete.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';
import { Post } from './decorators/post.decorator';
import { Put } from './decorators/put.decorator';
import { UndeclaredResultError } from './undeclared-result.error';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Property } from '../entity/decorators/property.decorator';
import { ConflictError } from '../error-handling/errors/conflict.error';
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
    ambiguous(): Greeting {
        return { message: 'which one' };
    }

    @Response.empty()
    @Get('/throws')
    throws(): void {
        throw new ConflictError($ts`nope`);
    }
}

// one server for both describes below, and both controllers on it: a decorated controller that no
// running application registers is an orphan, so a second server booting with only its own would
// fail on the other one before any test ran
let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    // routing reads and writes no rows, so the data source is the in memory one
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
        controllers: [GreetController, StatusController]
    });
    baseUrl = await server.start();
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

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