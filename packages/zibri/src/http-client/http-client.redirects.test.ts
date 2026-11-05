import { createServer, Server } from 'http';
import { createServer as createHttpsServer } from 'https';
import { AddressInfo } from 'net';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import express from 'express';
import { createFakeKeyPair, FakeKeyPair } from 'zibri-testing';

import { CircuitOpenError } from './circuit-open.error';
import { HttpClientOptionsInput } from './http-client-options.model';
import { HttpClientResponse } from './http-client-response.model';
import { HttpClientError } from './http-client.error';
import { HttpClientInterface } from './http-client.interface';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { DiContainer } from '../di/di-container';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { register } from '../di/register.function';
import { GlobalRegistry } from '../global/global-registry';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { Ms } from '../utilities/ms';

/**
 * What the echo route was sent.
 */
type Echo = {
    method: string,
    authorization?: string,
    cookie?: string,
    contentType?: string,
    body?: unknown
};

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

/**
 * Stops a server.
 * @param server - The server.
 */
async function close(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

/**
 * Answers with what the request carried.
 * @param req - The request.
 * @param res - The response.
 */
function echo(req: express.Request, res: express.Response): void {
    const answer: Echo = {
        method: req.method,
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        contentType: req.headers['content-type'],
        body: req.body
    };
    res.json(answer);
}

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

/**
 * What a call ends with.
 * @param call - The call.
 * @returns The error it rejected with, or undefined when it resolved.
 */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
    return await call.then(() => undefined, (error: unknown) => error);
}

let home: Server;
let homeUrl: string;
let elsewhere: Server;
let elsewhereUrl: string;
let down: Server;
let downUrl: string;
let secure: Server;
let secureUrl: string;
/**
 * The certificates every tls connection of this process trusted before the secure server's was added.
 */
const trustedBefore: string[] = getCACertificates('default');
/**
 * How many requests reached the route that redirects to itself.
 */
let loopRequests: number = 0;
/**
 * How many requests reached the origin that is down.
 */
let downRequests: number = 0;

// the errors the client builds carry translated messages, which an application that is not at
// least created refuses to build
beforeAll(async () => {
    GlobalRegistry.markAppAsCreated();

    const elsewhereApp: express.Express = express();
    elsewhereApp.use(express.json());
    elsewhereApp.all('/echo', echo);
    [elsewhere, elsewhereUrl] = await listen(elsewhereApp);

    const downApp: express.Express = express();
    downApp.get('/status', (_req, res) => {
        downRequests++;
        res.status(HttpStatus.SERVICE_UNAVAILABLE).json({});
    });
    [down, downUrl] = await listen(downApp);

    const homeApp: express.Express = express();
    homeApp.use(express.json());
    homeApp.all('/echo', echo);
    homeApp.get('/status', (_req, res) => {
        res.json({});
    });
    homeApp.get('/to-echo', (_req, res) => {
        res.redirect(HttpStatus.FOUND, '/echo');
    });
    homeApp.get('/to-elsewhere', (_req, res) => {
        res.redirect(HttpStatus.FOUND, `${elsewhereUrl}/echo`);
    });
    homeApp.get('/to-down', (_req, res) => {
        res.redirect(HttpStatus.FOUND, `${downUrl}/status`);
    });
    homeApp.post('/see-other', (_req, res) => {
        res.redirect(HttpStatus.SEE_OTHER, '/echo');
    });
    homeApp.post('/found', (_req, res) => {
        res.redirect(HttpStatus.FOUND, '/echo');
    });
    homeApp.post('/temporary', (_req, res) => {
        res.redirect(HttpStatus.TEMPORARY_REDIRECT, '/echo');
    });
    homeApp.get('/loop', (_req, res) => {
        loopRequests++;
        res.redirect(HttpStatus.FOUND, '/loop');
    });
    [home, homeUrl] = await listen(homeApp);

    const key: FakeKeyPair = await createFakeKeyPair('CN=Secure upstream', { hosts: ['127.0.0.1'] });
    const secureApp: express.Express = express();
    secureApp.get('/to-plain', (_req, res) => {
        res.redirect(HttpStatus.FOUND, `${homeUrl}/echo`);
    });
    secureApp.get('/to-secure', (_req, res) => {
        res.redirect(HttpStatus.FOUND, '/echo');
    });
    secureApp.all('/echo', echo);
    secure = createHttpsServer({ key: key.privateKey, cert: key.certificate }, secureApp);
    await new Promise<void>((resolve) => secure.listen(0, '127.0.0.1', resolve));
    secureUrl = `https://127.0.0.1:${(secure.address() as AddressInfo).port}`;
    // the client sends over node's own connections, which trust what the process trusts
    setDefaultCACertificates([...trustedBefore, key.certificate]);
});

afterAll(async () => {
    setDefaultCACertificates(trustedBefore);
    await Promise.all([home, elsewhere, down, secure].map(close));
});

beforeEach(() => {
    loopRequests = 0;
    downRequests = 0;
});

describe('following redirects', () => {
    it('follows a redirect by default', async () => {
        const res: HttpClientResponse = await clientWith({}).get(`${homeUrl}/to-echo`);

        expect(res.status).toBe(HttpStatus.OK);
        expect(res.rawBody).toMatchObject({ method: 'GET' });
    });

    it('refuses a redirect when the request says error, with the status and where it led', async () => {
        const error: unknown = await failureOf(clientWith({}).get(`${homeUrl}/to-echo`, { redirect: 'error' }));

        expect(error).toBeInstanceOf(HttpClientError);
        expect(error).toMatchObject({ responseData: { status: HttpStatus.FOUND, headers: { [KnownHeader.LOCATION]: '/echo' } } });
    });

    it('refuses every redirect when the application says error, unless the request says otherwise', async () => {
        const http: HttpClientInterface = clientWith({ redirect: 'error' });

        expect(await failureOf(http.get(`${homeUrl}/to-echo`))).toMatchObject({ responseData: { status: HttpStatus.FOUND } });
        expect((await http.get(`${homeUrl}/to-echo`, { redirect: 'follow' })).status).toBe(HttpStatus.OK);
    });

    it('follows a redirect within the origin and refuses one out of it with same-origin', async () => {
        const http: HttpClientInterface = clientWith({ redirect: 'same-origin' });

        expect((await http.get(`${homeUrl}/to-echo`)).status).toBe(HttpStatus.OK);
        expect(await failureOf(http.get(`${homeUrl}/to-elsewhere`))).toMatchObject({ responseData: { status: HttpStatus.FOUND } });
    });

    it('drops the credentials when a redirect leaves the origin, and keeps them within it', async () => {
        const headers: Record<string, string> = { [KnownHeader.AUTHORIZATION]: 'Bearer secret', [KnownHeader.COOKIE]: 'session=secret' };

        const within: HttpClientResponse = await clientWith({}).get(`${homeUrl}/to-echo`, { headers });
        expect(within.rawBody).toMatchObject({ authorization: 'Bearer secret', cookie: 'session=secret' });

        const out: HttpClientResponse = await clientWith({}).get(`${homeUrl}/to-elsewhere`, { headers });
        expect(out.rawBody).toEqual({ method: 'GET' });
    });

    it('sends a POST answered with 303 or 302 on as a GET without its body', async () => {
        for (const path of ['/see-other', '/found']) {
            const res: HttpClientResponse = await clientWith({}).post(`${homeUrl}${path}`, { name: 'Ada' });

            expect(res.rawBody).toEqual({ method: 'GET' });
        }
    });

    it('sends a POST answered with 307 on as the same POST', async () => {
        const res: HttpClientResponse = await clientWith({}).post(`${homeUrl}/temporary`, { name: 'Ada' });

        expect(res.rawBody).toMatchObject({ method: 'POST', contentType: 'application/json', body: { name: 'Ada' } });
    });

    it('gives up after 20 redirects in a row', async () => {
        const error: unknown = await failureOf(clientWith({}).get(`${homeUrl}/loop`));

        expect(error).toMatchObject({ responseData: { status: HttpStatus.FOUND } });
        expect(loopRequests).toBe(21);
    });

    it('follows a redirect from https to https, and refuses one from https to http', async () => {
        expect((await clientWith({}).get(`${secureUrl}/to-secure`)).status).toBe(HttpStatus.OK);

        const error: unknown = await failureOf(clientWith({}).get(`${secureUrl}/to-plain`));
        expect(error).toBeInstanceOf(HttpClientError);
        expect(error).toMatchObject({ responseData: { status: HttpStatus.FOUND, headers: { [KnownHeader.LOCATION]: `${homeUrl}/echo` } } });
    });

    it('counts each hop against the circuit of the origin that answered it', async () => {
        const http: HttpClientInterface = clientWith({ circuitBreaker: { failuresToOpen: 2, openForInMs: Ms.MINUTE } });
        await failureOf(http.get(`${homeUrl}/to-down`));
        await failureOf(http.get(`${homeUrl}/to-down`));

        expect(await failureOf(http.get(`${downUrl}/status`))).toBeInstanceOf(CircuitOpenError);
        expect(downRequests).toBe(2);
        // the origin that redirected answered every time
        expect((await http.get(`${homeUrl}/status`)).status).toBe(HttpStatus.OK);
    });
});

describe('redirects of a library', () => {
    it('hands a library that asks for manual the redirect itself', async () => {
        const res: Response = await clientWith({}).fetchForLibrary(`${homeUrl}/to-echo`, { redirect: 'manual' });

        expect(res.status).toBe(HttpStatus.FOUND);
        expect(res.headers.get(KnownHeader.LOCATION)).toBe('/echo');
    });

    it('follows the redirects of a library the way the application says', async () => {
        expect((await clientWith({}).fetchForLibrary(`${homeUrl}/to-echo`, {})).status).toBe(HttpStatus.OK);
        expect(await failureOf(clientWith({ redirect: 'error' }).fetchForLibrary(`${homeUrl}/to-echo`, {})))
            .toMatchObject({ responseData: { status: HttpStatus.FOUND } });
    });
});