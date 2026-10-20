import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import NodeFormData from 'form-data';

import { CircuitOpenError } from './circuit-open.error.ts';
import { HttpClientOptionsInput } from './http-client-options.model.ts';
import { HttpClientResponse } from './http-client-response.model.ts';
import { HttpClientError } from './http-client.error.ts';
import { HttpClientInterface } from './http-client.interface.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { DiContainer } from '../di/di-container.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider } from '../di/models/di-provider.model.ts';
import { register } from '../di/register.function.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { HttpMethod } from '../http/http-method.enum.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { FormDataBodyParser } from '../parsing/form-data/form-data.body-parser.ts';
import { FormData } from '../parsing/form-data/form-data.model.ts';
import { JsonBodyParser } from '../parsing/json/json.body-parser.ts';
import { Parser } from '../parsing/parser.ts';
import { StreamBodyParser } from '../parsing/stream/stream.body-parser.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';
import { Ms } from '../utilities/ms.ts';

class Item {
    @Property.string()
    name!: string;

    @Property.number()
    value!: number;
}

class FormDataItem {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;

    @Property.array({ items: { type: 'file', allowedMimeTypes: 'all' }, totalMaxSize: '5mb' })
    files!: File[];
}

describe('post', () => {
    let server: Server;
    let baseUrl: string;
    let http: HttpClientInterface;

    beforeAll(async () => {
        initDiContainer();
        // create mock api
        const app: express.Express = express();
        app.post('/valid', (_req, res) => {
            res.json({ name: 'ok', value: 42 });
        });
        app.post('/invalid', (_req, res) => {
            res.json({ name: 'broken', value: 'not-a-number' });
        });
        app.post('/form-data/valid', (_req, res) => {
            const form: NodeFormData = new NodeFormData();
            form.append('file', JsonUtilities.stringify({ hello: 'world' }), {
                filename: 'payload.json',
                contentType: MimeType.JSON
            });
            form.append('files', JsonUtilities.stringify({ hello: 'world2' }), {
                filename: 'files.json',
                contentType: MimeType.JSON
            });
            form.append('files', JsonUtilities.stringify({ hello: 'world3' }), {
                filename: 'files.json',
                contentType: MimeType.JSON
            });
            const headers: NodeFormData.Headers = form.getHeaders();
            res.setHeader(KnownHeader.CONTENT_TYPE, headers['content-type'] as string);
            form.pipe(res);
        });
        app.post('/form-data/invalid', (_req, res) => {
            const form: NodeFormData = new NodeFormData();
            form.append('file', JsonUtilities.stringify({ hello: 'world' }), {
                filename: 'payload.json',
                contentType: MimeType.JSON
            });
            const headers: NodeFormData.Headers = form.getHeaders();
            res.setHeader(KnownHeader.CONTENT_TYPE, headers['content-type'] as string);
            form.pipe(res);
        });
        server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const parser: Parser = inject(ZIBRI_DI_TOKENS.PARSER) as Parser;
        parser['bodyParsers'].push(inject(JsonBodyParser), inject(FormDataBodyParser), inject(StreamBodyParser));
        http = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });

    it('valid response should pass validation', async () => {
        const res: HttpClientResponse<Item> = await http.post(`${baseUrl}/valid`, undefined, { responseBody: Item });
        expect(res).toBeDefined();
        expect(res.body.name).toBe('ok');
        expect(res.body.value).toBe(42);
    });

    it('invalid response should trigger validation error', async () => {
        await expect(http.post(`${baseUrl}/invalid`, undefined, { responseBody: Item })).rejects.toThrow();
    });

    it('valid form data response should pass validation', async () => {
        const res: HttpClientResponse<FormData<FormDataItem>> = await http.post(
            `${baseUrl}/form-data/valid`,
            undefined,
            {
                responseBody: {
                    modelClass: FormDataItem,
                    type: MimeType.FORM_DATA
                }
            }
        );
        expect(res).toBeDefined();
        expect(res.body.value.file.size).toBe(17);
        expect(res.body.value.files.length).toBe(2);
    });

    it('invalid form data response should trigger validation error', async () => {
        await expect(http.post(`${baseUrl}/form-data/invalid`, undefined, { responseBody: { modelClass: FormDataItem, type: MimeType.FORM_DATA } })).rejects.toThrow();
    });
});

describe('get / put / patch / delete / headers / query params / error handling', () => {
    let server: Server;
    let baseUrl: string;
    let http: HttpClientInterface;

    beforeAll(async () => {
        initDiContainer();
        const app: express.Express = express();
        app.use(express.json());

        app.get('/valid', (_req, res) => {
            res.json({ name: 'ok', value: 42 });
        });
        app.put('/echo', (req, res) => {
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
            res.json({ name: req.body.name, value: req.body.value });
        });
        app.patch('/echo', (req, res) => {
            // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
            res.json({ name: req.body.name, value: req.body.value });
        });
        app.delete('/valid', (_req, res) => {
            res.json({ name: 'deleted', value: 0 });
        });
        app.get('/query-echo', (req, res) => {
            // eslint-disable-next-line typescript/no-base-to-string
            res.json({ name: String(req.query['search'] ?? ''), value: Number(req.query['limit'] ?? 0) });
        });
        app.get('/headers-echo', (req, res) => {
            res.setHeader('x-response-token', `echo:${req.headers['x-request-token'] as string}`);
            res.json({ name: 'ok', value: 1 });
        });
        app.get('/error/json', (_req, res) => {
            res.status(500).json({ code: 'boom' });
        });
        app.get('/error/plain-text', (_req, res) => {
            res.status(500).type('text/plain')
                .send('something went wrong');
        });
        app.post('/no-content', (_req, res) => {
            res.status(204).end();
        });
        // what an object store answers for an object stored without a type
        app.get('/stream/labelled', (_req, res) => {
            res.type('binary/octet-stream').send(Buffer.from('raw bytes'));
        });

        server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        // Shares the DiContainer singleton with the "post" describe above, so the Parser instance (and
        // its registered body parsers) is already set up — registering them again would duplicate them.
        const parser: Parser = inject(ZIBRI_DI_TOKENS.PARSER) as Parser;
        if (!parser['bodyParsers'].length) {
            parser['bodyParsers'].push(inject(JsonBodyParser), inject(FormDataBodyParser), inject(StreamBodyParser));
        }
        http = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });

    it('get() sends a GET request and validates the response', async () => {
        const res: HttpClientResponse<Item> = await http.get(`${baseUrl}/valid`, { responseBody: Item });
        expect(res.body.name).toBe('ok');
        expect(res.body.value).toBe(42);
    });

    it('get() without a responseBody returns the raw response without a parsed body', async () => {
        const res: HttpClientResponse = await http.get(`${baseUrl}/valid`);
        expect(res.status).toBe(200);
        expect(res.body).toBeUndefined();
        expect(res.rawBody).toEqual({ name: 'ok', value: 42 });
    });

    it('put() sends the body via PUT and validates the response', async () => {
        const res: HttpClientResponse<Item> = await http.put(`${baseUrl}/echo`, { name: 'put-item', value: 1 }, { responseBody: Item });
        expect(res.body.name).toBe('put-item');
        expect(res.body.value).toBe(1);
    });

    it('patch() sends the body via PATCH and validates the response', async () => {
        const res: HttpClientResponse<Item> = await http.patch(`${baseUrl}/echo`, { name: 'patch-item', value: 2 }, { responseBody: Item });
        expect(res.body.name).toBe('patch-item');
        expect(res.body.value).toBe(2);
    });

    it('delete() sends a DELETE request and validates the response', async () => {
        const res: HttpClientResponse<Item> = await http.delete(`${baseUrl}/valid`, { responseBody: Item });
        expect(res.body.name).toBe('deleted');
        expect(res.body.value).toBe(0);
    });

    it('does not throw when a successful response has an empty body (eg. 204 No Content)', async () => {
        const res: HttpClientResponse = await http.post(`${baseUrl}/no-content`, {});
        expect(res.status).toBe(204);
        expect(res.rawBody).toBeUndefined();
    });

    it('hands over a response declared as a stream whatever type the service names for it', async () => {
        const res: HttpClientResponse<Readable> = await http.get(`${baseUrl}/stream/labelled`, {
            responseBody: { type: MimeType.OCTET_STREAM }
        });
        expect(await text(res.body)).toBe('raw bytes');
    });

    it('forwards options.query as a query string, dropping undefined values', async () => {
        const res: HttpClientResponse<Item> = await http.get(`${baseUrl}/query-echo`, {
            query: { search: 'abc', limit: 5, unused: undefined },
            responseBody: Item
        });
        expect(res.body.name).toBe('abc');
        expect(res.body.value).toBe(5);
    });

    it('sends request headers and validates parsed response headers', async () => {
        const res: HttpClientResponse<Item, { 'x-response-token': string }> = await http.get(`${baseUrl}/headers-echo`, {
            headers: { 'x-request-token': 'my-token' },
            responseBody: Item,
            responseHeaders: { 'x-response-token': { type: 'string' } }
        });
        expect(res.headers['x-response-token']).toBe('echo:my-token');
    });

    it('throws a HttpClientError with the parsed JSON body when the response is an error with a JSON body', async () => {
        await expect(http.get(`${baseUrl}/error/json`)).rejects.toMatchObject({
            responseData: { body: { code: 'boom' }, status: 500 }
        });
    });

    it('throws a HttpClientError with the raw text body when the error response body is not JSON', async () => {
        await expect(http.get(`${baseUrl}/error/plain-text`)).rejects.toMatchObject({
            responseData: { body: 'something went wrong', status: 500 }
        });
    });

    it('throws a HttpClientError with requestData populated when no response can be received', async () => {
        // Port 1 is a privileged port with nothing listening, so the connection is refused immediately.
        const unreachableUrl: string = 'http://127.0.0.1:1/unreachable';

        await expect(http.get(unreachableUrl)).rejects.toBeInstanceOf(HttpClientError);
        await expect(http.get(unreachableUrl)).rejects.toMatchObject({
            responseData: undefined,
            requestData: {
                method: HttpMethod.GET,
                url: unreachableUrl,
                body: undefined,
                headers: {}
            }
        });
    });
});

/**
 * The http client, with the given options over the defaults.
 * @param options - What the application configures.
 * @returns The client.
 */
function clientWith(options: HttpClientOptionsInput): HttpClientInterface {
    DiContainer.reset();
    initDiContainer();
    register(defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT, useValue: options }));
    return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
}

describe('fetchForLibrary', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        const app: express.Express = express();
        app.use(express.urlencoded({ extended: false }));
        app.post('/token', (req, res) => {
            res.json({
                method: req.method,
                authorization: req.headers.authorization,
                // eslint-disable-next-line typescript/no-unsafe-assignment
                body: req.body
            });
        });
        app.post('/refused', (_req, res) => {
            res.status(400).json({ error: 'invalid_grant' });
        });
        app.get('/no-content', (_req, res) => {
            res.status(204).end();
        });
        app.get('/large', (_req, res) => {
            res.type('text/plain').send('x'.repeat(2048));
        });
        server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });

    it('sends the method, headers and body it is given', async () => {
        const res: Response = await clientWith({}).fetchForLibrary(`${baseUrl}/token`, {
            method: 'POST',
            headers: { authorization: 'Basic abc', 'content-type': MimeType.FORM_URL_ENCODED },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: 'the-code' })
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            method: 'POST',
            authorization: 'Basic abc',
            body: { grant_type: 'authorization_code', code: 'the-code' }
        });
    });

    it('hands back a status that is not ok as a response, with its body', async () => {
        const res: Response = await clientWith({}).fetchForLibrary(`${baseUrl}/refused`, { method: 'POST' });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'invalid_grant' });
    });

    it('hands back a response without a body', async () => {
        const res: Response = await clientWith({}).fetchForLibrary(`${baseUrl}/no-content`, {});

        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
    });

    it('refuses a body larger than the application allows', async () => {
        await expect(clientWith({ defaultMaxResponseSize: '1kb' }).fetchForLibrary(`${baseUrl}/large`, {}))
            .rejects
            .toThrow('Could not read the response body');
    });

    it('reads a body larger than the application allows when the call allows it', async () => {
        const res: Response = await clientWith({ defaultMaxResponseSize: '1kb' })
            .fetchForLibrary(`${baseUrl}/large`, {}, { maxResponseSize: '4kb' });

        expect(await res.text()).toHaveLength(2048);
    });

    it('goes out through the dispatcher the application configured', async () => {
        const http: HttpClientInterface = clientWith({
            dispatcher: {
                dispatch: () => {
                    throw new Error('refused by the corporate proxy');
                }
            }
        });

        const error: unknown = await http.fetchForLibrary(`${baseUrl}/no-content`, {}).catch((error_: unknown) => error_);

        // fetch hangs the reason off `cause`
        expect(error).toMatchObject({ cause: { message: 'refused by the corporate proxy' } });
    });
});
describe('idempotency keys', () => {
    let server: Server;
    let baseUrl: string;
    /**
     * The headers of every request the server was sent, in order.
     */
    const received: Record<string, string | string[] | undefined>[] = [];

    beforeAll(async () => {
        const app: express.Express = express();
        // the answer to the first request is lost after it arrived, the way a dropped connection
        // loses it: the server did the work, and the client cannot tell that from a request that
        // never landed
        app.post('/lost-once', (req, res) => {
            received.push(req.headers);
            if (received.length === 1) {
                req.socket.destroy();
                return;
            }
            res.json({});
        });
        server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    });

    beforeEach(() => {
        received.length = 0;
    });

    it('repeats a POST whose answer was lost when it carries a key, with the same key on every attempt', async () => {
        const res: HttpClientResponse = await clientWith({}).post(`${baseUrl}/lost-once`, {}, { attempts: 2, idempotencyKey: true });

        expect(res.status).toBe(200);
        expect(received).toHaveLength(2);
        const key: unknown = received[0]?.[KnownHeader.IDEMPOTENCY_KEY];
        expect(typeof key).toBe('string');
        expect(received[1]?.[KnownHeader.IDEMPOTENCY_KEY]).toBe(key);
    });

    it('does not repeat a POST whose answer was lost without a key', async () => {
        await expect(clientWith({}).post(`${baseUrl}/lost-once`, {}, { attempts: 2 })).rejects.toBeInstanceOf(HttpClientError);
        expect(received).toHaveLength(1);
    });

    it('sends a given key, under the header a provider names', async () => {
        await clientWith({}).post(`${baseUrl}/lost-once`, {}, { attempts: 2, idempotencyKey: 'order-1' });
        expect(received.map(h => h[KnownHeader.IDEMPOTENCY_KEY])).toEqual(['order-1', 'order-1']);

        received.length = 0;
        await clientWith({}).post(`${baseUrl}/lost-once`, {}, { attempts: 2, idempotencyKey: { value: 'order-2', header: 'PayPal-Request-Id' } });
        expect(received.map(h => h['paypal-request-id'])).toEqual(['order-2', 'order-2']);
        expect(received[0]?.[KnownHeader.IDEMPOTENCY_KEY]).toBeUndefined();
    });
});

describe('circuit breaker', () => {
    let down: Server;
    let downUrl: string;
    let up: Server;
    let upUrl: string;
    /**
     * How many requests reached the origin that is down.
     */
    let downRequests: number = 0;
    /**
     * What the origin that is down answers.
     */
    let downStatus: number = 503;

    /**
     * Starts a server.
     * @param app - What it serves.
     * @returns The server and its url.
     */
    async function listen(app: express.Express): Promise<[Server, string]> {
        const server: Server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`];
    }

    beforeAll(async () => {
        const downApp: express.Express = express();
        downApp.get('/status', (_req, res) => {
            downRequests++;
            res.status(downStatus).json({});
        });
        [down, downUrl] = await listen(downApp);
        const upApp: express.Express = express();
        upApp.get('/status', (_req, res) => {
            res.json({});
        });
        [up, upUrl] = await listen(upApp);
    });

    afterAll(async () => {
        await Promise.all([down, up].map(async s => await new Promise<void>((resolve, reject) => s.close((err) => err ? reject(err) : resolve()))));
    });

    beforeEach(() => {
        downRequests = 0;
        downStatus = 503;
    });

    /**
     * What a call ends with.
     * @param call - The call.
     * @returns The error it rejected with, or undefined when it resolved.
     */
    async function failureOf(call: Promise<unknown>): Promise<unknown> {
        return await call.then(() => undefined, (error: unknown) => error);
    }

    it('refuses requests to an origin that failed too often in a row without sending them, and only to that origin', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForMs: Ms.MINUTE } });

        expect(await failureOf(http.get(`${downUrl}/status`))).toMatchObject({ responseData: { status: 503 } });
        expect(await failureOf(http.get(`${downUrl}/status`))).toMatchObject({ responseData: { status: 503 } });

        const refused: unknown = await failureOf(http.get(`${downUrl}/status`));
        expect(refused).toBeInstanceOf(CircuitOpenError);
        expect(refused).toBeInstanceOf(HttpClientError);
        expect(refused).toMatchObject({ origin: downUrl });
        expect(downRequests).toBe(2);

        expect((await http.get(`${upUrl}/status`)).status).toBe(200);
    });

    it('stops retrying once the circuit opens', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForMs: Ms.MINUTE } });

        expect(await failureOf(http.get(`${downUrl}/status`, { attempts: 5 }))).toBeInstanceOf(CircuitOpenError);
        expect(downRequests).toBe(2);
    });

    it('lets one request through after openForMs, and closes when it is answered', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForMs: 200 } });
        await failureOf(http.get(`${downUrl}/status`));
        await failureOf(http.get(`${downUrl}/status`));

        await wait(250);
        downStatus = 200;
        expect((await http.get(`${downUrl}/status`)).status).toBe(200);

        // closed: a single failure no longer opens it
        downStatus = 503;
        await failureOf(http.get(`${downUrl}/status`));
        expect(await failureOf(http.get(`${downUrl}/status`))).toMatchObject({ responseData: { status: 503 } });
        expect(downRequests).toBe(5);
    });

    it('opens again at once when the request let through fails', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForMs: 200 } });
        await failureOf(http.get(`${downUrl}/status`));
        await failureOf(http.get(`${downUrl}/status`));

        await wait(250);
        expect(await failureOf(http.get(`${downUrl}/status`))).toMatchObject({ responseData: { status: 503 } });
        expect(await failureOf(http.get(`${downUrl}/status`))).toBeInstanceOf(CircuitOpenError);
        expect(downRequests).toBe(3);
    });

    it('counts any answer below 500 as the origin being up', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForMs: Ms.MINUTE } });

        await failureOf(http.get(`${downUrl}/status`));
        downStatus = 429;
        await failureOf(http.get(`${downUrl}/status`));
        downStatus = 503;
        await failureOf(http.get(`${downUrl}/status`));

        expect(await failureOf(http.get(`${downUrl}/status`))).toMatchObject({ responseData: { status: 503 } });
        expect(downRequests).toBe(4);
    });

    it('counts a request that got no answer as a failure', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForMs: Ms.MINUTE } });
        // port 1 refuses the connection at once
        await failureOf(http.get('http://127.0.0.1:1/status'));
        await failureOf(http.get('http://127.0.0.1:1/status'));

        expect(await failureOf(http.get('http://127.0.0.1:1/status'))).toBeInstanceOf(CircuitOpenError);
    });

    it('is on by default, opening after five failures in a row', async () => {
        const http: HttpClientInterface = clientWith({});
        for (let i: number = 0; i < 5; i++) {
            await failureOf(http.get(`${downUrl}/status`));
        }

        expect(await failureOf(http.get(`${downUrl}/status`))).toBeInstanceOf(CircuitOpenError);
        expect(downRequests).toBe(5);
    });

    it('sends every request when the application turns it off', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: false });
        for (let i: number = 0; i < 8; i++) {
            expect(await failureOf(http.get(`${downUrl}/status`))).toMatchObject({ responseData: { status: 503 } });
        }
        expect(downRequests).toBe(8);
    });
});