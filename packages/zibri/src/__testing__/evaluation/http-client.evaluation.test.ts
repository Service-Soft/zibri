import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { DiContainer } from '../../di/di-container';
import { initDiContainer } from '../../di/init-di-container.function';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { register } from '../../di/register.function';
import { HttpClientDispatcher } from '../../http-client/http-client-options.model';
import { HttpClientResponse } from '../../http-client/http-client-response.model';
import { HttpClientInterface } from '../../http-client/http-client.interface';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 4.1.
 *
 * The retry policy is entirely in-process, so it is observed rather than inspected: point the
 * client at a local server that counts requests and answers with a client error, then check how
 * often the server was actually hit. No source inspection, no containers.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

type RecordedRequest = {
    /**
     * The http method the client used.
     */
    method: string,
    /**
     * The path the client requested.
     */
    url: string
};

let server: Server;
let baseUrl: string;
let received: RecordedRequest[] = [];
/**
 * The status the stub server answers with, set per test.
 */
let responseStatus: number = 200;
/**
 * The Retry-After the stub server names, in seconds, or undefined to send none.
 */
let retryAfterSeconds: number | undefined = undefined;
/**
 * Comfortably over the 10mb the client allows a body it was told nothing about.
 */
const oversizedBodyBytes: number = 12 * 1024 * 1024;

beforeAll(async () => {
    // the http client is a plain DI provider, so the container is all it needs - no application
    // and no database container
    DiContainer.reset();
    initDiContainer();
    // off, because every case is about what one request does, and they all share one client and one
    // stub origin answering 5xx on purpose: the breaker would carry the failures of one case into the
    // next and refuse its request. Its own cases are in http-client.test.ts
    register(defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT, useValue: { circuitBreaker: false } }));

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        received.push({ method: req.method ?? '', url: req.url ?? '' });

        if (req.url === '/oversized-body') {
            // finite and ends on its own, so the test terminates whether the cap works or not.
            // Chunked, with no content-length, which is the case the counter exists for - an
            // upstream is free to omit the length or to lie about it
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(`"${'x'.repeat(oversizedBodyBytes)}"`);
            return;
        }

        if (req.url === '/oversized-declared-body') {
            // announces more than the limit before sending anything, which is the cheap path: the
            // answer is refused without a byte of body being read
            res.writeHead(200, {
                'content-type': 'application/json',
                'content-length': String(oversizedBodyBytes)
            });
            res.end(`"${'x'.repeat(oversizedBodyBytes - 2)}"`);
            return;
        }

        if (req.url === '/slow-body') {
            // headers arrive immediately, the body never finishes - a slow upstream, or one that
            // died after flushing its head
            res.writeHead(200, { 'content-type': 'application/json' });
            res.write('{"partial":');
            return;
        }

        res.writeHead(responseStatus, {
            'content-type': 'application/json',
            ...retryAfterSeconds == undefined ? {} : { 'retry-after': String(retryAfterSeconds) }
        });
        res.end('{}');
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address: AddressInfo | string | null = server.address();
    if (address == undefined || typeof address === 'string') {
        throw new Error('could not resolve the stub server port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

afterEach(() => {
    received = [];
    retryAfterSeconds = undefined;
});

describe('evaluation/04-infrastructure-subsystems 4.1 - http client retries', () => {

    it('does not retry a GET that came back as a client error', async () => {
        responseStatus = 400;
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

        await expect(http.get(`${baseUrl}/bad-request`, { attempts: 3 })).rejects.toThrow();

        // every non-2xx is thrown into the catch and retried, with no method check and no status
        // classification - a 400 will never become a 200 no matter how often it is asked
        expect(received).toHaveLength(1);
    }, 30000);

    it('does not re-submit a POST that came back as a conflict', async () => {
        responseStatus = 409;
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

        await expect(
            http.post(`${baseUrl}/payments`, { amount: 100 }, { attempts: 3 })
        ).rejects.toThrow();

        // this is the damaging case: retrying a POST that the server already rejected as a
        // duplicate charges the customer again
        expect(received.filter(r => r.method === 'POST')).toHaveLength(1);
    }, 30000);

    it('still retries a server error, which is the case retries exist for', async () => {
        responseStatus = 503;
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

        await expect(http.get(`${baseUrl}/unavailable`, { attempts: 3 })).rejects.toThrow();

        // guards the two tests above: if this fails then retrying was disabled wholesale rather
        // than classified, which is not the fix either
        expect(received).toHaveLength(3);
    }, 30000);

    it('re-sends a POST the server refused to look at', async () => {
        responseStatus = 429;
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

        await expect(
            http.post(`${baseUrl}/payments`, { amount: 100 }, { attempts: 3 })
        ).rejects.toThrow();

        // the one case where repeating a non-idempotent request is safe: a 429 counted the request
        // and refused it, so it cannot have charged anything. Refusing to retry here would make
        // every rate limited write fail that a moment's patience would have completed
        expect(received.filter(r => r.method === 'POST')).toHaveLength(3);
    }, 30000);

    it('waits between attempts instead of firing them back to back', async () => {
        responseStatus = 503;
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
        const startedAt: number = Date.now();

        await expect(http.get(`${baseUrl}/unavailable`, { attempts: 4 })).rejects.toThrow();

        // three waits over a doubling window, each at least half of it: 125 + 250 + 500. Half the
        // window is random rather than the whole of it precisely so this floor exists - a delay that
        // can roll near zero is a backoff that sometimes does not back off
        expect(received).toHaveLength(4);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(875);
    }, 30000);

    it('waits as long as the server asked rather than guessing', async () => {
        responseStatus = 503;
        retryAfterSeconds = 1;
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
        const startedAt: number = Date.now();

        await expect(http.get(`${baseUrl}/unavailable`, { attempts: 2 })).rejects.toThrow();

        // Retry-After is the only party that knows when it will be ready again, so coming back
        // sooner is asking to be refused a second time
        expect(received).toHaveLength(2);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
    }, 30000);
});

describe('evaluation/04-infrastructure-subsystems 4.2 - http client body reads', () => {

    it('gives up on a response whose body never arrives', async () => {
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
        const startedAt: number = Date.now();

        await expect(http.get(`${baseUrl}/slow-body`, { timeoutMs: 500 })).rejects.toThrow();

        // the deadline used to be cleared as soon as fetch resolved, which is when the *headers*
        // arrive - the body read then ran with no deadline at all, so a dribbling or hung upstream
        // held the call open indefinitely. It now covers the whole answer
        expect(Date.now() - startedAt).toBeLessThan(5000);
    }, 15000);

    it('refuses a body larger than it is willing to hold', async () => {
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

        // no content-length, so the only thing that can stop this is counting the body as it
        // arrives. Reading with response.text() would commit the whole answer to the heap and only
        // then compare it against the limit, which is the memory the limit exists to protect
        await expect(http.get(`${baseUrl}/oversized-body`)).rejects.toThrow('Could not read the response body');
    }, 30000);

    it('refuses a body that announces itself as too large before reading it', async () => {
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);

        // the cheap path: an upstream that declares more than the limit is turned away without a
        // byte of body being read. It is free to lie or to say nothing, which is why the counting
        // above still happens
        await expect(http.get(`${baseUrl}/oversized-declared-body`)).rejects.toThrow('Could not read the response body');
    }, 30000);
});

/**
 * A dispatcher that refuses to connect, saying who it was.
 *
 * Stands in for the `ProxyAgent`, the `Agent` carrying a CA bundle and the one carrying a client
 * certificate the finding is about. All three are a `Dispatcher`, and the framework's job is not to
 * build them - it is to send over the one it was handed, which is what these tests assert.
 *
 * **Refusing is what makes the assertion strong**, and it took a failed attempt to see that. The
 * first version delegated to node's own dispatcher so a real response came back, which meant reading
 * `globalThis[Symbol.for('undici.globalDispatcher.1')]` - and inside jest `globalThis` is the test
 * sandbox's rather than node's, so the symbol is not there and never will be. What replaced it is
 * better anyway: a dispatcher that cannot connect proves the request went *through* it rather than
 * around it, because the stub server records nothing. A delegating one could not have told the two
 * apart - the server would have been hit either way.
 * @param name - What this dispatcher calls itself when it refuses.
 * @returns The dispatcher.
 */
function refusingDispatcher(name: string): HttpClientDispatcher {
    // a Dispatcher is a class with more than twenty methods, and only `dispatch` is on the path a
    // fetch takes. The cast is to the type undici itself would satisfy; writing the other twenty
    // would be mocking an interface this test does not own
    return {
        dispatch: () => {
            throw new Error(`refused by ${name}`);
        }
    } as unknown as HttpClientDispatcher;
}

/**
 * Finds the marker a refusing dispatcher threw, wherever fetch buried it.
 *
 * `fetch` reports anything from the connection path as `TypeError: fetch failed` and hangs the real
 * reason off `cause`, and the client wraps that again as its own error - so the name has to be dug
 * for rather than matched on a message.
 *
 * **`instanceof Error` cannot be used to walk it**, which this cost a run to find out. The
 * `TypeError` fetch throws is built in node's realm and jest runs a test file in a context of its
 * own, so the sandbox's `Error` is a different class and `instanceof` answers no about a value that
 * is exactly what it claims to be. That is the seam
 * [05 §D7](../../../../evaluation/05-di-metadata-and-packaging.md) refuses to let two copies of the
 * framework create, met here for real. Shape is what can be relied on across it.
 * @param error - The error the client rejected with.
 * @returns Every message in the chain, joined.
 */
function causeChain(error: unknown): string {
    const messages: string[] = [];
    let current: unknown = error;
    while (typeof current === 'object' && current != undefined && 'message' in current) {
        messages.push(String(current.message));
        current = 'cause' in current ? current.cause : undefined;
    }
    return messages.join(' | ');
}

/**
 * Points the http client at the given application wide dispatcher, or at none.
 * @param dispatcher - What every request should go out through, or undefined for the default.
 * @returns The client.
 */
function clientWithDispatcher(dispatcher: HttpClientDispatcher | undefined): HttpClientInterface {
    DiContainer.reset();
    initDiContainer();
    // registered after the defaults, which is how an application configures the framework: a
    // providers array is read front to back and the last entry wins
    register(defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT, useValue: { dispatcher } }));
    return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
}

describe('evaluation/04-infrastructure-subsystems 4.3 - egress is configurable', () => {

    it('sends through the dispatcher the application configured', async () => {
        responseStatus = 200;
        const http: HttpClientInterface = clientWithDispatcher(refusingDispatcher('the corporate proxy'));

        const error: unknown = await http.get(`${baseUrl}/through-a-proxy`).catch((error_: unknown) => error_);

        // `fetch` used to be called with nothing but a signal, so a proxy, a CA bundle or a client
        // certificate could not be named at all - the request went straight out whatever the
        // deployment's egress policy said
        expect(causeChain(error)).toContain('refused by the corporate proxy');
        // and it went *through* it rather than past it: the stub server, which the control below
        // shows is perfectly reachable, was never touched
        expect(received).toHaveLength(0);
    }, 30000);

    it('lets one request go out through a different dispatcher than the rest', async () => {
        responseStatus = 200;
        const http: HttpClientInterface = clientWithDispatcher(refusingDispatcher('the corporate proxy'));

        const error: unknown = await http
            .get(`${baseUrl}/mtls-partner`, { dispatcher: refusingDispatcher('the partner certificate') })
            .catch((error_: unknown) => error_);

        // mutual tls to one partner is a property of that destination rather than of the
        // deployment, so the per-request one replaces the application's rather than layering over it
        expect(causeChain(error)).toContain('refused by the partner certificate');
        expect(causeChain(error)).not.toContain('refused by the corporate proxy');
    }, 30000);

    it('still sends when no dispatcher was named anywhere', async () => {
        responseStatus = 200;

        // the control the two above need: without it they would both pass just as well if the
        // client only ever sent anything when it was handed a dispatcher
        const res: HttpClientResponse = await clientWithDispatcher(undefined).get(`${baseUrl}/no-dispatcher`);

        expect(res.status).toBe(200);
        expect(received).toHaveLength(1);
    }, 30000);
});