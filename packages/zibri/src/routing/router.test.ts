import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { Body } from './decorators/body.decorator';
import { Controller } from './decorators/controller.decorator';
import { Delete } from './decorators/delete.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';
import { Post } from './decorators/post.decorator';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Property } from '../entity/decorators/property.decorator';
import { KnownHeader } from '../http/known-header.enum';
import { Response } from '../open-api/decorators/response.decorator';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

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

    @Delete('/:id')
    remove(
        @Param.path('id', { type: 'string' })
        id: string
    ): void {
        void id;
    }
}

describe('Router — HTTP dispatch', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [GreetController] });
        baseUrl = await server.start();
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

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
            location: JSON.stringify(location),
            tags: JSON.stringify(tags),
            matrix: JSON.stringify(matrix)
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
            body: JSON.stringify({ name: 'Ada' })
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
            body: JSON.stringify({})
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
        const res: Response = await fetch(`${baseUrl}/greet/mismatch/response`);
        expect(res.status).toBe(500);
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

    it('dispatches DELETE requests and returns an empty body', async () => {
        const res: Response = await fetch(`${baseUrl}/greet/abc`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const text: string = await res.text();
        expect(text).toBe('');
    });
});