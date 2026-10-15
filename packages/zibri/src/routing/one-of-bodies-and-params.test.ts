import assert from 'assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Body } from './decorators/body.decorator';
import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { Param } from './decorators/param.decorator';
import { Post } from './decorators/post.decorator';
import { RouterInterface } from './router.interface';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Property } from '../entity/decorators/property.decorator';
import { HttpMethod } from '../http/http-method.enum';
import { MimeType } from '../http/mime-type.enum';
import { HttpClientResponse } from '../http-client/http-client-response.model';
import { HttpClientInterface } from '../http-client/http-client.interface';
import { Response as ZibriResponse } from '../open-api/decorators/response.decorator';
import { OpenApiDefinition, OpenApiOperation, OpenApiParameter, OpenApiReferenceObject, OpenApiSchemaObject } from '../open-api/open-api.model';
import { File } from '../parsing/form-data/file.model';
import { FormData as ZibriFormData } from '../parsing/form-data/form-data.model';
import { JsonBodyParser } from '../parsing/json/json.body-parser';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ValidationProblem } from '../validation/validation-problem.model';
import { ValidationService } from '../validation/validation.service';
import { WebsocketBody } from '../websocket/decorators/websocket-body.decorator';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

class Signup {
    @Property.string({ regex: /^[^\s@]+@[^\s@]+$/ })
    email!: string;

    @Property.date({ required: false })
    birthday?: Date;
}

class Invite {
    @Property.string()
    code!: string;

    @Property.date()
    expiresAt!: Date;
}

class Inner {
    @Property.string()
    label!: string;
}

class Middle {
    @Property.object({ cls: () => Inner })
    inner!: Inner;
}

class Outer {
    @Property.object({ cls: () => Middle })
    middle!: Middle;
}

class Photo {
    @Property.string()
    caption!: string;

    @Property.file({ allowedMimeTypes: 'all', maxSize: '1kb' })
    photo!: File;
}

class Note {
    @Property.string()
    caption!: string;

    @Property.string()
    text!: string;
}

/**
 * What an endpoint answers about a body it received: which shape it became, and the value.
 */
type Echo = {
    /**
     * The name of the shape.
     */
    kind: string,
    /**
     * The value as the handler got it, with dates written out.
     */
    value: unknown
};

/**
 * Names the shape a value became.
 * @param value - The value the handler got.
 * @returns The class name for an instance of a model, otherwise what kind of value it is.
 */
function kindOf(value: unknown): string {
    if (Array.isArray(value)) {
        return `${kindOf(value[0])}[]`;
    }
    if (value instanceof Date) {
        return 'date';
    }
    if (typeof value === 'object' && value != undefined) {
        return 'code' in value ? 'Invite' : 'Signup';
    }
    return typeof value;
}

@Controller('/shapes')
class ShapesController {
    @Post('/account')
    account(
        @Body.oneOf({ shapes: [{ type: 'object', cls: () => Signup }, { type: 'object', cls: () => Invite }] })
        body: Signup | Invite
    ): Echo {
        return { kind: kindOf(body), value: body };
    }

    @Post('/one-or-many')
    oneOrMany(
        @Body.oneOf({
            shapes: [
                { type: 'object', cls: () => Signup },
                { type: 'array', items: { type: 'object', cls: () => Signup } }
            ]
        })
        body: Signup | Signup[]
    ): Echo {
        return { kind: kindOf(body), value: body };
    }

    @Post('/optional')
    optional(
        @Body.oneOf({ shapes: [{ type: 'object', cls: () => Signup }, { type: 'object', cls: () => Invite }], required: false })
        body: Signup | Invite | undefined
    ): { received: boolean } {
        return { received: body !== undefined };
    }

    @Post('/list')
    list(@Body(Signup, { isArray: true }) body: Signup[]): Echo {
        return { kind: kindOf(body), value: body };
    }

    @Post('/nested')
    nested(@Body(Outer) body: Outer): Outer {
        return body;
    }

    @Post('/sized')
    sized(@Body(Outer, { maxSize: '1kb' }) body: Outer): Outer {
        return body;
    }

    // names a class declared below this one, the way two files importing each other do: it exists
    // once the module has loaded, not yet while the decorator runs
    @ZibriResponse.object(() => DeclaredLater)
    @ZibriResponse.object(Invite)
    @Post('/declared-later')
    declaredLater(
        @Body.oneOf({ shapes: [{ type: 'object', cls: () => DeclaredLater }, { type: 'object', cls: () => Invite }], maxSize: '1kb' })
        body: DeclaredLater | Invite
    ): DeclaredLater | Invite {
        return body;
    }

    @Post('/upload')
    async upload(
        @Body.oneOf({
            type: MimeType.FORM_DATA,
            shapes: [{ type: 'object', cls: () => Photo }, { type: 'object', cls: () => Note }]
        })
        form: ZibriFormData<Photo | Note>
    ): Promise<{ kind: string, caption: string }> {
        const res: { kind: string, caption: string } = {
            kind: 'photo' in form.value ? 'Photo' : 'Note',
            caption: form.value.caption
        };
        await form.cleanup();
        return res;
    }

    @Get('/page')
    page(
        @Param.query('size', { type: 'oneOf', shapes: [{ type: 'number', min: 1 }, { type: 'string', enum: { all: 'all' } }] })
        size: number | 'all'
    ): { size: number | 'all', kind: string } {
        return { size, kind: typeof size };
    }

    @Get('/at/:when')
    at(
        @Param.path('when', { type: 'oneOf', shapes: [{ type: 'date' }, { type: 'string', enum: { now: 'now' } }] })
        when: Date | 'now'
    ): { kind: string } {
        return { kind: kindOf(when) };
    }

    @Get('/tenant')
    tenant(
        @Param.header('x-tenant', { type: 'oneOf', shapes: [{ type: 'number', format: 'integer' }, { type: 'string' }] })
        tenant: number | string
    ): { kind: string } {
        return { kind: kindOf(tenant) };
    }

    @Get('/either')
    either(): unknown {
        return { code: 'abc', expiresAt: '2026-03-01T10:00:00.000Z' };
    }
}

class DeclaredLater {
    @Property.string()
    note!: string;
}

class WebsocketHandlers {
    handle(
        @WebsocketBody.oneOf({ shapes: [{ type: 'object', cls: () => Signup }, { type: 'object', cls: () => Invite }] })
        body: Signup | Invite
    ): void {
        void body;
    }
}

/**
 * The validation problems a refused request was answered with, one line each.
 * @param res - The response.
 * @returns Each problem as `- key: message`.
 */
async function problemsOf(res: Response): Promise<string[]> {
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const body: { paragraphs: string[] } = await res.json();
    return body.paragraphs.filter(p => p.startsWith('- '));
}

describe('bodies and parameters that take one of several shapes', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [ShapesController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            version: '1.0.0'
        });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Posts a json body.
     * @param path - Where to, below the base url.
     * @param body - What to send, before it becomes json.
     * @returns The response.
     */
    async function postJson(path: string, body?: unknown): Promise<Response> {
        return await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JsonUtilities.stringify(body)
        });
    }

    describe('a json body', () => {
        it('becomes the first shape the body fits, with its dates restored', async () => {
            const signup: Response = await postJson('/shapes/account', { email: 'a@b.c', birthday: '2000-01-01T00:00:00.000Z' });
            expect(signup.status).toBe(200);
            await expect(signup.json()).resolves.toEqual({
                kind: 'Signup',
                value: { email: 'a@b.c', birthday: '2000-01-01T00:00:00.000Z' }
            });

            const invite: Response = await postJson('/shapes/account', { code: 'x', expiresAt: '2026-03-01T10:00:00.000Z' });
            expect(invite.status).toBe(200);
            await expect(invite.json()).resolves.toEqual({
                kind: 'Invite',
                value: { code: 'x', expiresAt: '2026-03-01T10:00:00.000Z' }
            });
        });

        it('takes one model or a list of them', async () => {
            const one: Response = await postJson('/shapes/one-or-many', { email: 'a@b.c' });
            await expect(one.json()).resolves.toEqual({ kind: 'Signup', value: { email: 'a@b.c' } });

            const many: Response = await postJson('/shapes/one-or-many', [{ email: 'a@b.c' }, { email: 'd@e.f' }]);
            await expect(many.json()).resolves.toEqual({ kind: 'Signup[]', value: [{ email: 'a@b.c' }, { email: 'd@e.f' }] });
        });

        it('answers 400 with one problem naming every shape when the body fits none', async () => {
            const res: Response = await postJson('/shapes/account', { email: 'not an address' });

            expect(res.status).toBe(400);
            const problems: string[] = await problemsOf(res);
            expect(problems).toHaveLength(1);
            expect(problems[0]).toMatch(/^- body: .*Signup.*Invite/s);
        });

        it('answers 400 for a missing body that is required, and passes on one that is not', async () => {
            await expect(postJson('/shapes/account').then(r => r.status)).resolves.toBe(400);

            const optional: Response = await postJson('/shapes/optional');
            expect(optional.status).toBe(200);
            await expect(optional.json()).resolves.toEqual({ received: false });
        });

        it('reports a problem inside a list body under the index of the item', async () => {
            const res: Response = await postJson('/shapes/list', [{ email: 'a@b.c' }, { email: 42 }]);

            expect(res.status).toBe(400);
            await expect(problemsOf(res)).resolves.toEqual([expect.stringMatching(/^- 1\.email: /)]);
        });

        it('reports a problem two classes deep under its whole path', async () => {
            const res: Response = await postJson('/shapes/nested', { middle: { inner: { label: 5 } } });

            expect(res.status).toBe(400);
            await expect(problemsOf(res)).resolves.toEqual([expect.stringMatching(/^- middle\.inner\.label: /)]);
        });

        it('keeps a body within its size when the model holds classes of its own', async () => {
            // nothing in these classes is a file, so the body may weigh what it was given and no more
            const res: Response = await postJson('/shapes/sized', { middle: { inner: { label: 'x'.repeat(1500) } } });

            expect(res.status).toBe(413);
        });

        it('takes a shape whose class is declared after the route, within the size it was given', async () => {
            const res: Response = await postJson('/shapes/declared-later', { note: 'hello' });
            expect(res.status).toBe(200);
            await expect(res.json()).resolves.toEqual({ note: 'hello' });
            const invite: Response = await postJson('/shapes/declared-later', { code: 'x', expiresAt: '2026-03-01T10:00:00.000Z' });
            await expect(invite.json()).resolves.toEqual({ code: 'x', expiresAt: '2026-03-01T10:00:00.000Z' });

            await expect(postJson('/shapes/declared-later', { note: 'x'.repeat(1500) }).then(r => r.status)).resolves.toBe(413);
        });

        it('reports an unknown key two classes deep under its whole path, alongside the other problems', async () => {
            const res: Response = await postJson('/shapes/nested', { middle: { inner: { label: 5, extra: true } } });

            expect(res.status).toBe(400);
            expect((await problemsOf(res)).sort()).toEqual([
                expect.stringMatching(/^- middle\.inner\.extra: /),
                expect.stringMatching(/^- middle\.inner\.label: /)
            ]);
        });
    });

    describe('a form data body', () => {
        it('becomes the first class whose fields and files the form fits', async () => {
            const photoForm: FormData = new FormData();
            photoForm.append('caption', 'beach');
            photoForm.append('photo', new Blob(['tiny'], { type: 'image/png' }), 'beach.png');
            const photo: Response = await fetch(`${baseUrl}/shapes/upload`, { method: 'POST', body: photoForm });
            expect(photo.status).toBe(200);
            await expect(photo.json()).resolves.toEqual({ kind: 'Photo', caption: 'beach' });

            const noteForm: FormData = new FormData();
            noteForm.append('caption', 'todo');
            noteForm.append('text', 'buy milk');
            const note: Response = await fetch(`${baseUrl}/shapes/upload`, { method: 'POST', body: noteForm });
            expect(note.status).toBe(200);
            await expect(note.json()).resolves.toEqual({ kind: 'Note', caption: 'todo' });
        });

        it('answers 400 when the form fits none of the classes', async () => {
            const form: FormData = new FormData();
            form.append('caption', 'too big');
            form.append('photo', new Blob(['x'.repeat(2000)], { type: 'image/png' }), 'big.png');

            const res: Response = await fetch(`${baseUrl}/shapes/upload`, { method: 'POST', body: form });

            expect(res.status).toBe(400);
        });

        it('refuses a shape other than a class when the decorator runs', () => {
            expect(() => Body.oneOf({
                type: MimeType.FORM_DATA,
                // @ts-expect-error a form is made of named fields, so only a class describes one
                shapes: [{ type: 'object', cls: () => Note }, { type: 'string' }]
            })).toThrow(/form data.*class/i);
        });
    });

    describe('a parameter', () => {
        it('becomes the first shape a query parameter fits', async () => {
            const numbered: Response = await fetch(`${baseUrl}/shapes/page?size=20`);
            await expect(numbered.json()).resolves.toEqual({ size: 20, kind: 'number' });

            const all: Response = await fetch(`${baseUrl}/shapes/page?size=all`);
            await expect(all.json()).resolves.toEqual({ size: 'all', kind: 'string' });

            const neither: Response = await fetch(`${baseUrl}/shapes/page?size=0`);
            expect(neither.status).toBe(400);
            await expect(problemsOf(neither)).resolves.toEqual([expect.stringMatching(/^- size: /)]);
        });

        it('becomes the first shape a path parameter fits', async () => {
            const date: Response = await fetch(`${baseUrl}/shapes/at/2026-03-01T10:00:00.000Z`);
            await expect(date.json()).resolves.toEqual({ kind: 'date' });

            const now: Response = await fetch(`${baseUrl}/shapes/at/now`);
            await expect(now.json()).resolves.toEqual({ kind: 'string' });

            await expect(fetch(`${baseUrl}/shapes/at/later`).then(r => r.status)).resolves.toBe(400);
        });

        it('becomes the first shape a header fits', async () => {
            const numbered: Response = await fetch(`${baseUrl}/shapes/tenant`, { headers: { 'x-tenant': '7' } });
            await expect(numbered.json()).resolves.toEqual({ kind: 'number' });

            const named: Response = await fetch(`${baseUrl}/shapes/tenant`, { headers: { 'x-tenant': 'acme' } });
            await expect(named.json()).resolves.toEqual({ kind: 'string' });
        });

        it('refuses a class as a shape of a path parameter when the decorator runs', () => {
            expect(() => Param.path('id', {
                type: 'oneOf',
                // @ts-expect-error a path segment is one piece of text, which no class describes
                shapes: [{ type: 'number' }, { type: 'object', cls: () => Note }]
            })).toThrow(/path parameter/i);
        });
    });

    describe('a route registered on the router', () => {
        it('reads its body as the first shape it fits, and types the handler with every shape', async () => {
            const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
            router.registerRoute({
                httpMethod: HttpMethod.POST,
                route: '/manual/account',
                openApi: { useInOpenApi: false },
                bodyMetadata: { shapes: [{ type: 'object', cls: () => Signup }, { type: 'object', cls: () => Invite }] },
                queryParams: { size: { type: 'oneOf', shapes: [{ type: 'number' }, { type: 'string', enum: { all: 'all' } }] } },
                handler: req => {
                    const body: Signup | Invite = req.body;
                    const size: number | string = req.query['size'];
                    return { kind: kindOf(body), size };
                }
            });

            const res: Response = await postJson('/manual/account?size=all', { code: 'x', expiresAt: '2026-03-01T10:00:00.000Z' });

            expect(res.status).toBe(200);
            await expect(res.json()).resolves.toEqual({ kind: 'Invite', size: 'all' });
        });

        it('types the handler with a list of the model for a list body', async () => {
            const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
            router.registerRoute({
                httpMethod: HttpMethod.POST,
                route: '/manual/accounts',
                openApi: { useInOpenApi: false },
                bodyMetadata: { modelClass: Signup, isArray: true },
                handler: req => {
                    const body: Signup[] = req.body;
                    return { count: body.length };
                }
            });

            const res: Response = await postJson('/manual/accounts', [{ email: 'a@b.c' }, { email: 'd@e.f' }]);

            await expect(res.json()).resolves.toEqual({ count: 2 });
        });
    });

    describe('the http client', () => {
        it('reads a response as the first shape it fits, typed as every shape', async () => {
            const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

            const res: HttpClientResponse<Signup | Invite> = await http.get(`${baseUrl}/shapes/either`, {
                responseBody: { shapes: [{ type: 'object', cls: () => Signup }, { type: 'object', cls: () => Invite }] }
            });

            expect(res.body).toEqual({ code: 'abc', expiresAt: new Date('2026-03-01T10:00:00.000Z') });
        });

        it('refuses a response that fits none of the shapes', async () => {
            const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

            await expect(http.get(`${baseUrl}/shapes/either`, {
                responseBody: { shapes: [{ type: 'object', cls: () => Signup }, { type: 'array', items: { type: 'string' } }] }
            })).rejects.toThrow(/validate/);
        });
    });

    describe('a websocket body', () => {
        it('becomes the first shape the body fits', async () => {
            const metadata: ReturnType<typeof MetadataUtilities.getRouteBody> = MetadataUtilities.getRouteBody(WebsocketHandlers, 'handle');
            assert(metadata?.type === MimeType.JSON);
            const request: WebsocketRequest = new WebsocketRequest();
            request.body = { code: 'x', expiresAt: '2026-03-01T10:00:00.000Z' };

            const value: unknown = new JsonBodyParser().parseFromWebsocketRequest(request, metadata);
            const problems: ValidationProblem[] = await new ValidationService().getBodyValidationProblems(value, metadata);

            expect(problems).toEqual([]);
            expect(value).toEqual({ code: 'x', expiresAt: new Date('2026-03-01T10:00:00.000Z') });
        });
    });

    describe('the OpenAPI document', () => {
        let spec: OpenApiDefinition;

        beforeAll(async () => {
            const res: Response = await fetch(`${baseUrl}/explorer/spec/1.0.0`);
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            spec = await res.json();
        });

        /**
         * Looks up an operation in the spec, asserting it exists.
         * @param path - The OpenAPI path key.
         * @param method - The http method key.
         * @returns The operation.
         */
        function op(path: string, method: 'get' | 'post'): OpenApiOperation {
            const operation: OpenApiOperation | undefined = spec.paths?.[path]?.[method];
            assert(operation);
            return operation;
        }

        /**
         * The json schema of an operation's request body.
         * @param operation - The operation.
         * @returns Its schema.
         */
        function bodySchema(operation: OpenApiOperation): OpenApiSchemaObject {
            assert(operation.requestBody && !('$ref' in operation.requestBody));
            const schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined = operation.requestBody.content[MimeType.JSON]?.schema;
            assert(schema && !('$ref' in schema));
            return schema;
        }

        it('describes a body of several shapes as anyOf', () => {
            expect(bodySchema(op('/shapes/one-or-many', 'post'))).toEqual({
                anyOf: [
                    expect.objectContaining({ type: 'object', properties: expect.objectContaining({ email: expect.anything() }) }),
                    expect.objectContaining({ type: 'array', items: expect.objectContaining({ type: 'object' }) })
                ]
            });
        });

        it('describes a list body as an array', () => {
            expect(bodySchema(op('/shapes/list', 'post'))).toEqual(expect.objectContaining({
                type: 'array',
                items: expect.objectContaining({ type: 'object', properties: expect.objectContaining({ email: expect.anything() }) })
            }));
        });

        it('describes responses of one status as oneOf, also one whose class is declared after the route', () => {
            const ok: unknown = op('/shapes/declared-later', 'post').responses?.['default'];
            expect(ok).toEqual(expect.objectContaining({
                content: {
                    [MimeType.JSON]: {
                        schema: {
                            oneOf: [
                                expect.objectContaining({ properties: expect.objectContaining({ code: expect.anything() }) }),
                                expect.objectContaining({ properties: { note: expect.anything() } })
                            ]
                        }
                    }
                }
            }));
        });

        it('describes a parameter of several shapes as anyOf', () => {
            const size: OpenApiParameter | undefined = op('/shapes/page', 'get').parameters?.find(p => 'name' in p && p.name === 'size');
            expect(size).toEqual(expect.objectContaining({
                in: 'query',
                schema: { anyOf: [expect.objectContaining({ type: 'number', minimum: 1 }), expect.objectContaining({ type: 'string', enum: ['all'] })] }
            }));
        });
    });
});