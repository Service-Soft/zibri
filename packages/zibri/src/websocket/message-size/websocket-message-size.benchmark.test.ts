import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { WebsocketFrameScanner } from './websocket-frame.scanner';
import { WebsocketMessageSizeScanner } from './websocket-message-size.scanner';
import { BenchmarkTiming } from '../../__testing__/benchmark/benchmark-timing.model';
import { BenchmarkUtilities } from '../../__testing__/benchmark/benchmark.utilities';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../di/models/di-provider.model';
import { Property } from '../../entity/decorators/property.decorator';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { WebsocketBody } from '../decorators/websocket-body.decorator';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';

/**
 * What measuring every websocket message against its event's size costs: the frame scanner on its
 * own, per message of a few sizes, and a round trip through the server with it in place.
 *
 * The scanner reads a frame's header and the first bytes of a message, and counts the rest by the
 * length the header declares, so its cost should not grow with the message. Nothing here fails on
 * the numbers - see `BenchmarkUtilities`.
 *
 * `npm run test:benchmark` runs it. Setting `ZIBRI_BENCHMARK_UPDATE_BASELINE=1` makes the run the new
 * baseline.
 */

/**
 * The sizes of the messages the scanner is timed on, and how often each is.
 */
const SIZES: { bytes: number, runs: number }[] = [
    { bytes: 100, runs: 2000 },
    { bytes: 10 * 1024, runs: 2000 },
    { bytes: 1024 * 1024, runs: 200 }
];

/**
 * The size of the chunks a message arrives in, about what one read of a socket yields.
 */
const CHUNK_BYTES: number = 64 * 1024;

/**
 * How many round trips through the server are timed.
 */
const ROUND_TRIPS: number = 1000;

const baselinePath: FsPath = FsUtilities.getPath(__dirname, 'websocket-message-size.baseline.json');

const reportPath: FsPath = FsUtilities.getPath(testFileFolder, 'websocket-message-size.benchmark-report.json');

class Note {
    @Property.string({ maxLength: 10_000 })
    text!: string;
}

@WebsocketController({ allowOrphan: true, eventPrefix: 'bench:' })
class BenchmarkWsController {
    @WebsocketRoute('note')
    note(@WebsocketBody(Note, { maxSize: '100kb' }) note: Note): number {
        return note.text.length;
    }
}

/**
 * The event the test sends, and what it is answered with.
 */
type SentEvents = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    'bench:note': (request: { body: Note }, answer: (message: WebsocketMessage) => void) => void
};

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    maxMessageSize: '2mb'
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';
let client: Socket<Record<string, never>, SentEvents> | undefined;

/**
 * A frame carrying a message of the given size, in the chunks it would arrive in.
 * @param bytes - How large the message is.
 * @returns The chunks.
 */
function chunksOf(bytes: number): Buffer[] {
    const payload: Buffer = Buffer.from(`42["bench:note",{"body":{"text":"${'x'.repeat(bytes)}"}}]`, 'utf8');
    const header: Buffer = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
    const bytesOnTheWire: Buffer = Buffer.concat([header, randomBytes(4), payload]);
    const chunks: Buffer[] = [];
    for (let i: number = 0; i < bytesOnTheWire.length; i += CHUNK_BYTES) {
        chunks.push(bytesOnTheWire.subarray(i, i + CHUNK_BYTES));
    }
    return chunks;
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [BenchmarkWsController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
        ]
    });
    baseUrl = await server.start();
    client = io(baseUrl, { auth: { offset: 0 }, transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
        client?.once('connect', resolve);
        client?.once('connect_error', reject);
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    client?.disconnect();
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('measuring websocket messages against their events', () => {
    it('measures the frame scanner per message, and a round trip with it in place', async () => {
        const timings: BenchmarkTiming[] = [];
        const scanner: WebsocketFrameScanner = new WebsocketFrameScanner(new WebsocketMessageSizeScanner(() => 2 * 1024 * 1024));
        for (const { bytes, runs } of SIZES) {
            const chunks: Buffer[] = chunksOf(bytes);
            timings.push(await BenchmarkUtilities.resolveTiming(`scanning a message of ${bytes} bytes`, runs, () => {
                for (const chunk of chunks) {
                    expect(scanner.push(chunk)).toBeUndefined();
                }
                return Promise.resolve();
            }));
        }

        const socket: Socket<Record<string, never>, SentEvents> | undefined = client;
        expect(socket).toBeDefined();
        if (socket != undefined) {
            timings.push(await BenchmarkUtilities.resolveTiming('a round trip of a 1 kb message', ROUND_TRIPS, async () => {
                const answer: WebsocketMessage = await socket.timeout(5000).emitWithAck('bench:note', { body: { text: 'x'.repeat(1024) } });
                expect(answer.ok).toBe(true);
            }));
        }

        const report: string = await BenchmarkUtilities.resolveReport(
            timings,
            reportPath,
            baselinePath,
            process.env['ZIBRI_BENCHMARK_UPDATE_BASELINE'] === '1'
        );
        process.stdout.write(`\n${report}\n\n`);

        expect(timings.every(t => Number.isFinite(t.medianMs) && Number.isFinite(t.p95Ms))).toBe(true);
    }, 600_000);
});
