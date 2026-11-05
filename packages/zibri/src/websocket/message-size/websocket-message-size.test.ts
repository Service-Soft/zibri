import { connect, Socket as TcpSocket } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { DisconnectDescription, io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { RawWebsocketClient, RawWebsocketClose } from '../../__testing__/raw-websocket-client.model';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { Property } from '../../entity/decorators/property.decorator';
import { HttpServerLimits } from '../../http/http-server-limits.model';
import { Route } from '../../routing/controller-route-configuration.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { WebsocketBody } from '../decorators/websocket-body.decorator';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';

/**
 * The size of one kilobyte, as `FileSize` counts it.
 */
const KB: number = 1024;

/**
 * The size of one megabyte, as `FileSize` counts it.
 */
const MB: number = KB * KB;

/**
 * Where the websocket server listens in these tests.
 */
const PATH: Route = '/live';

class Note {
    @Property.string({ maxLength: 10 * MB })
    text!: string;
}

/**
 * How many messages reached a handler, by event.
 */
const handled: Map<string, number> = new Map();

/**
 * Counts a handled message.
 * @param event - The event.
 */
function count(event: string): void {
    handled.set(event, (handled.get(event) ?? 0) + 1);
}

@WebsocketController({ allowOrphan: true, eventPrefix: 'size:' })
class SizeWsController {
    // a size of its own
    @WebsocketRoute('note')
    note(@WebsocketBody(Note, { maxSize: '1kb' }) note: Note): number {
        count('size:note');
        return note.text.length;
    }

    // the size the application allows a json body
    @WebsocketRoute('memo')
    memo(@WebsocketBody(Note) note: Note): number {
        count('size:memo');
        return note.text.length;
    }

    // no body, so nothing but the size of a message
    @WebsocketRoute('ping')
    ping(): string {
        count('size:ping');
        return 'pong';
    }
}

/**
 * The event the test sends, and what it is answered with.
 */
type SentEvents = {

    // a text, or a buffer the client sends as a binary attachment
    'size:note': (request: { body: { text: string | Buffer } }, answer: (message: WebsocketMessage) => void) => void,

    'size:memo': (request: { body: Note }, answer: (message: WebsocketMessage) => void) => void,

    'size:ping': (request: { body: unknown }, answer: (message: WebsocketMessage) => void) => void
};

type Client = Socket<Record<string, never>, SentEvents>;

/**
 * What the engine answers the request that opens a polling session with.
 */
type PollingHandshake = {
    sid: string
};

/**
 * What a client learns when the server closes its connection.
 */
type Disconnection = {
    reason: string,
    closeCode: number | undefined
};

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    path: PATH,
    // far above what any event allows, so that it is the events' sizes that refuse below
    maxMessageSize: '256mb',
    // not to be hit: a raw client answers no ping while it is busy, and the one that waits for its
    // declared bytes never would
    pingIntervalInMs: 10_000,
    pingTimeoutInMs: 30_000
};

const serverLimits: HttpServerLimits = {
    requestTimeoutInMs: Ms.SECOND * 60,
    headersTimeoutInMs: Ms.SECOND * 15,
    keepAliveTimeoutInMs: Ms.SECOND * 75,
    handlerTimeoutInMs: Ms.SECOND * 30,
    maxHeaderCount: 100,
    maxHeaderSizeInBytes: 16 * 1024,
    maxBodySizes: { json: '2kb', xml: '2kb', formUrlEncoded: '2kb', formData: '2kb', stream: '2kb' }
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';
const clients: Client[] = [];
const rawClients: RawWebsocketClient[] = [];
const tcpSockets: TcpSocket[] = [];

/**
 * Opens a socket.io connection.
 * @param transport - Which transport it stays on.
 * @returns The connected socket.
 */
async function connectClient(transport: 'websocket' | 'polling'): Promise<Client> {
    const socket: Client = io(baseUrl, { path: PATH, auth: { offset: 0 }, transports: [transport], upgrade: false });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
    });
    return socket;
}

/**
 * Waits for the server to end a connection.
 * @param socket - The connection.
 * @returns Why, and the close code the websocket was closed with, if it was one.
 */
async function waitForDisconnect(socket: Client): Promise<Disconnection> {
    return await new Promise<Disconnection>(resolve => {
        socket.once('disconnect', (reason: string, details: DisconnectDescription | undefined) => {
            resolve({ reason, closeCode: resolveCloseCode(details) });
        });
    });
}

/**
 * The close code inside what the client reports about a websocket that was closed.
 * @param details - What it reports.
 * @returns The code, or undefined when there is none.
 */
function resolveCloseCode(details: DisconnectDescription | undefined): number | undefined {
    if (details == undefined || details instanceof Error || typeof details.context !== 'object' || details.context == undefined) {
        return undefined;
    }
    return 'code' in details.context && typeof details.context.code === 'number' ? details.context.code : undefined;
}

/**
 * Opens a raw websocket connection.
 * @returns The connected client.
 */
async function connectRaw(): Promise<RawWebsocketClient> {
    const client: RawWebsocketClient = await RawWebsocketClient.connect(baseUrl, PATH);
    rawClients.push(client);
    return client;
}

/**
 * The engine.io packet of an event with the given body, as a client sends it.
 * @param event - The event.
 * @param text - The text of the note it carries.
 * @returns The packet.
 */
function notePacket(event: string, text: string): string {
    return `42["${event}",{"body":{"text":"${text}"}}]`;
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [SizeWsController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions }),
            defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS, useValue: serverLimits })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
    for (const client of rawClients.splice(0)) {
        client.destroy();
    }
    for (const socket of tcpSockets.splice(0)) {
        socket.destroy();
    }
    handled.clear();
});

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe.each(['websocket', 'polling'] as const)('a message over %s', transport => {
    it('is refused when it is over the size its event declares, and the handler never sees it', async () => {
        const socket: Client = await connectClient(transport);
        const disconnected: Promise<Disconnection> = waitForDisconnect(socket);

        socket.emit('size:note', { body: { text: 'x'.repeat(2000) } }, () => {});

        const disconnection: Disconnection = await disconnected;
        expect(disconnection.reason).toMatch(/^transport (close|error)$/);
        if (transport === 'websocket') {
            expect(disconnection.closeCode).toBe(1009);
        }
        expect(handled.get('size:note')).toBeUndefined();
    }, 15_000);

    it('is taken when it is within the size its event declares', async () => {
        const socket: Client = await connectClient(transport);

        // unknown, since socket.io-client types the answer of an acknowledgement with a timeout as any
        const answer: unknown = await socket.timeout(5000).emitWithAck('size:note', { body: { text: 'x'.repeat(500) } });

        expect(answer).toMatchObject({ ok: true, data: 500 });
        expect(handled.get('size:note')).toBe(1);
    }, 15_000);

    it('is bounded by what the application allows a json body when its event declares no size', async () => {
        const within: Client = await connectClient(transport);
        expect(await within.timeout(5000).emitWithAck('size:memo', { body: { text: 'x'.repeat(1500) } })).toMatchObject({ ok: true, data: 1500 });

        const over: Client = await connectClient(transport);
        const disconnected: Promise<Disconnection> = waitForDisconnect(over);
        over.emit('size:memo', { body: { text: 'x'.repeat(3000) } }, () => {});

        expect((await disconnected).reason).toMatch(/^transport (close|error)$/);
        expect(handled.get('size:memo')).toBe(1);
    }, 15_000);

    it('is bounded by the size of a message alone when its event has no body', async () => {
        const socket: Client = await connectClient(transport);

        const answer: unknown = await socket.timeout(10_000).emitWithAck('size:ping', { body: 'x'.repeat(MB + (100 * KB)) });

        expect(answer).toMatchObject({ ok: true, data: 'pong' });
    }, 20_000);

    it('counts the binary attachments of a message against the size of its event', async () => {
        const socket: Client = await connectClient(transport);
        const disconnected: Promise<Disconnection> = waitForDisconnect(socket);

        // a buffer travels as a binary attachment after the message that names it
        socket.emit('size:note', { body: { text: Buffer.alloc(2000, 'x') } }, () => {});

        expect((await disconnected).reason).toMatch(/^transport (close|error)$/);
        expect(handled.get('size:note')).toBeUndefined();
    }, 15_000);
});

describe('a message whose bytes never arrive', () => {
    it('is refused by its declared length, before any of its payload', async () => {
        const client: RawWebsocketClient = await connectRaw();
        const prefix: Buffer = Buffer.from(notePacket('size:note', ''), 'utf8').subarray(0, 30);

        client.writeFrameHeader(1, true, 200 * MB);
        expect(await client.write(prefix)).toBe(true);

        const close: RawWebsocketClose = await client.waitForClose(2000);
        expect(close.code).toBe(1009);
        expect(close.reason).toContain('size:note');
        expect(client.bytesWritten).toBeLessThan(KB);
        expect(handled.get('size:note')).toBeUndefined();
    }, 15_000);

    it('is cut while it is still being sent, and never held in memory', async () => {
        const client: RawWebsocketClient = await connectRaw();
        const chunk: Buffer = Buffer.alloc(64 * KB, 'x');
        const head: Buffer = Buffer.from(notePacket('size:note', ''), 'utf8').subarray(0, 30);
        const declared: number = 200 * MB;
        const buffersBefore: number = process.memoryUsage().arrayBuffers;

        client.writeFrameHeader(1, true, declared);
        await client.write(head);
        let written: number = head.length;
        while (written < declared && await client.write(chunk)) {
            written += chunk.length;
        }

        expect((await client.waitForClose(2000)).code).toBe(1009);
        // the operating system took a few buffers' worth before the server closed the connection;
        // nothing near the 200 MB declared, and none of it was handed to the process
        expect(written).toBeLessThan(32 * MB);
        expect(process.memoryUsage().arrayBuffers - buffersBefore).toBeLessThan(32 * MB);
        expect(handled.get('size:note')).toBeUndefined();
    }, 30_000);

    it('is refused once its fragments add up to more than its event allows', async () => {
        const client: RawWebsocketClient = await connectRaw();
        const first: Buffer = Buffer.from(notePacket('size:note', 'x'.repeat(300)).slice(0, -5), 'utf8');
        const fragment: Buffer = Buffer.alloc(300, 'x');

        client.sendFrame({ opcode: 1, fin: false, payload: first });
        let fragments: number = 0;
        while (client.isOpen && fragments < 20) {
            client.sendFrame({ opcode: 0, fin: false, payload: fragment });
            fragments++;
            await new Promise<void>(resolve => setTimeout(resolve, 20));
        }

        expect((await client.waitForClose(2000)).code).toBe(1009);
        // 300 and then 300 a fragment: the third fragment takes the message past 1024
        expect(fragments).toBeLessThanOrEqual(4);
        expect(handled.get('size:note')).toBeUndefined();
    }, 15_000);

    it('is taken when its fragments stay within what its event allows', async () => {
        const client: RawWebsocketClient = await connectRaw();
        const packet: Buffer = Buffer.from(notePacket('size:note', 'x'.repeat(400)), 'utf8');

        client.sendFrame({ opcode: 1, fin: false, payload: packet.subarray(0, 100) });
        client.sendFrame({ opcode: 0, fin: false, payload: packet.subarray(100, 300) });
        client.sendFrame({ opcode: 0, fin: true, payload: packet.subarray(300) });

        expect(await client.nextMessage()).toContain('"data":400');
        expect(handled.get('size:note')).toBe(1);
    }, 15_000);
});

describe('a polling request whose bytes never arrive in full', () => {
    it('is answered 413 once what has arrived is over the size, before the rest of the body', async () => {
        const url: URL = new URL(baseUrl);
        const open: string = await (await fetch(`${baseUrl}${PATH}/?EIO=4&transport=polling`)).text();
        const { sid }: PollingHandshake = JsonUtilities.parse<PollingHandshake>(open.slice(1));
        const session: string = `${PATH}/?EIO=4&transport=polling&sid=${sid}`;
        expect(await (await fetch(`${baseUrl}${session}`, { method: 'POST', body: '40' })).text()).toBe('ok');
        await (await fetch(`${baseUrl}${session}`)).text();

        const socket: TcpSocket = connect(Number(url.port), url.hostname);
        tcpSockets.push(socket);
        await new Promise<void>(resolve => socket.once('connect', resolve));
        const response: Promise<string> = new Promise<string>(resolve => {
            let head: string = '';
            socket.on('data', (chunk: Buffer) => {
                head += chunk.toString('latin1');
                if (head.includes('\r\n\r\n')) {
                    resolve(head.split('\r\n')[0] ?? '');
                }
            });
        });
        socket.write([
            `POST ${session} HTTP/1.1`,
            `Host: ${url.host}`,
            'Content-Type: text/plain;charset=UTF-8',
            `Content-Length: ${200 * MB}`,
            '',
            // the bytes up to the size are read, since a request may carry several messages and
            // only the bytes say which is over; the 200 MB after them are not
            notePacket('size:note', '').slice(0, 30) + 'x'.repeat(4 * KB)
        ].join('\r\n'));

        expect(await Promise.race([response, new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error('no answer in 2 s')), 2000))]))
            .toMatch(/^HTTP\/1\.1 413 /);
        expect(handled.get('size:note')).toBeUndefined();
    }, 15_000);
});