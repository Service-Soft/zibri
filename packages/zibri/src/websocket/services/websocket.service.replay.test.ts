import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { CronJob } from '../../cron/cron-job.model';
import { type CronServiceInterface } from '../../cron/cron-service.interface';
import { CronService } from '../../cron/cron.service';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { Ms } from '../../utilities/ms';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessageSequence, WebsocketMessageSequenceCreateData } from '../models/websocket-message-sequence.model';
import { CreateWebsocketMessageData, WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketReplayIncomplete } from '../models/websocket-replay-incomplete.model';
import { WebsocketMessageCleanupCronJob } from '../websocket-message-cleanup.cron-job';

@WebsocketController({ allowOrphan: true, eventPrefix: 'replay:' })
class ReplayWsController {
    @WebsocketRoute('ping')
    ping(): string {
        return 'pong';
    }
}

/**
 * The event the messages of this suite are sent as.
 */
const noteEvent: string = 'replay:note';

/**
 * How many missed messages a reconnecting client is sent at most, here.
 */
const maxReplayedMessages: number = 3;

/**
 * How long a client is given to answer a message that asks for an answer. Long, so that a replay
 * waiting for answers is told apart from one that does not by the clock alone.
 */
const timeoutInMs: number = 3000;

/**
 * How long a client is watched for messages it is not supposed to get.
 */
const quietPeriodInMs: number = 300;

// one for both applications of this file: a data source that is declared stays registered, and an
// application that does not deploy it is refused for it before anything this file is about runs
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities });

let server: StartedTestServer;
let baseUrl: string;
let wsService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
const sockets: Socket[] = [];

/**
 * What a client received, in the order it arrived.
 */
type Received = {
    /**
     * The seq of every note.
     */
    notes: number[],
    /**
     * What a replay that could not be complete said instead.
     */
    incomplete: WebsocketReplayIncomplete[]
};

function messageRepository(): Repository<WebsocketMessage, CreateWebsocketMessageData> {
    return inject(repositoryTokenFor(WebsocketMessage));
}

function sequenceRepository(): Repository<WebsocketMessageSequence, WebsocketMessageSequenceCreateData> {
    return inject(repositoryTokenFor(WebsocketMessageSequence));
}

/**
 * The seq of the newest message stored, which is where a client that saw everything stands.
 * @returns The seq, or 0 when nothing is stored.
 */
async function resolveNewestSeq(): Promise<number> {
    const [newest] = await messageRepository().findAll({ order: { seq: 'DESC' }, take: 1, acrossTenants: true });
    return newest?.seq ?? 0;
}

/**
 * Stores a note for everyone, while nobody is connected to receive it.
 */
async function sendNote(): Promise<void> {
    await wsService.sendToAll({
        event: noteEvent,
        message: { ok: true, data: {}, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: false
    });
}

/**
 * Connects a client that has seen everything up to an offset, and records what it is sent. It never
 * answers a message, so a replay that waits for answers waits out every one of them.
 * @param offset - The seq of the last message the client saw.
 * @returns What it receives, filled in as it arrives.
 */
async function connect(offset: number): Promise<Received> {
    const received: Received = { notes: [], incomplete: [] };
    const socket: Socket = io(baseUrl, { auth: { offset }, autoConnect: false, reconnection: false });
    sockets.push(socket);
    socket.on(noteEvent, (message: WebsocketMessage) => received.notes.push(message.seq));
    socket.on(WebsocketEvent.REPLAY_INCOMPLETE, (message: WebsocketMessage) => {
        received.incomplete.push(message.data as WebsocketReplayIncomplete);
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
    });
    return received;
}

/**
 * Runs the cleanup the application registered, once.
 */
async function runCleanup(): Promise<void> {
    const cronService: CronServiceInterface = inject(ZIBRI_DI_TOKENS.CRON_SERVICE);
    const job: CronJob | undefined = cronService.cronJobs.find(j => j instanceof WebsocketMessageCleanupCronJob);
    if (!(job instanceof WebsocketMessageCleanupCronJob)) {
        throw new Error('the application registered no WebsocketMessageCleanupCronJob');
    }
    await job.onTick();
}

/**
 * The providers of this suite, with the websocket options left out when asked to.
 * @param withWebsocketOptions - Whether the application says how long its messages are kept.
 * @returns The providers.
 */
function resolveProviders(withWebsocketOptions: boolean): DiProvider<unknown>[] {
    const providers: DiProvider<unknown>[] = defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT);
    return withWebsocketOptions
        ? [
            ...providers,
            defineProvider({
                token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                useValue: { messageRetentionInMs: Ms.HOUR, maxReplayedMessages, timeoutInMs }
            }),
            // the real one rather than the test stub, which registers nothing: that the application
            // registers the cleanup is part of what is tested
            defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
        ]
        : providers;
}

describe('replaying what a reconnecting client missed', () => {
    beforeAll(async () => {
        server = await startTestServer({
            websocketControllers: [ReplayWsController],
            dataSources: [dataSourceClass],
            providers: resolveProviders(true)
        });
        baseUrl = await server.start();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(() => {
        for (const socket of sockets.splice(0)) {
            socket.disconnect();
        }
    });

    it('sends every missed message in order, without waiting for the client to answer each', async () => {
        const offset: number = await resolveNewestSeq();
        for (let i: number = 0; i < maxReplayedMessages; i++) {
            await sendNote();
        }

        const received: Received = await connect(offset);

        // well inside the time the client would have been given to answer the first one
        await waitUntil(() => received.notes.length === maxReplayedMessages, timeoutInMs / 2);
        expect(received.notes).toEqual([offset + 1, offset + 2, offset + 3]);
        expect(received.incomplete).toEqual([]);
    }, 15000);

    it('sends none of them when more are missed than it replays, and tells the client where things stand', async () => {
        const offset: number = await resolveNewestSeq();
        for (let i: number = 0; i <= maxReplayedMessages; i++) {
            await sendNote();
        }
        const newest: number = await resolveNewestSeq();

        const received: Received = await connect(offset);

        await waitUntil(() => received.incomplete.length === 1);
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
        expect(received.incomplete).toEqual([{ seq: newest }]);
        expect(received.notes).toEqual([]);
    }, 15000);

    it('sends none of them when messages after the offset are no longer kept, and tells the client', async () => {
        const offset: number = await resolveNewestSeq();
        await sendNote();
        await sendNote();
        const [expired, kept] = await messageRepository().findAll({ where: { seq: { greaterThan: offset } }, acrossTenants: true });
        if (expired == undefined || kept == undefined) {
            throw new Error('the two notes were not stored');
        }
        await messageRepository().updateById(expired.id, { createdAt: new Date(Date.now() - Ms.HOUR - Ms.MINUTE) }, { acrossTenants: true });

        await runCleanup();

        // the cleanup takes what is older than the retention, and only that
        const left: WebsocketMessage[] = await messageRepository().findAll({ where: { seq: { greaterThan: offset } }, acrossTenants: true });
        expect(left.map(m => m.id)).toEqual([kept.id]);

        const received: Received = await connect(offset);
        await waitUntil(() => received.incomplete.length === 1);
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
        expect(received.incomplete).toEqual([{ seq: kept.seq }]);
        expect(received.notes).toEqual([]);

        // a client that saw what was deleted is still sent the rest
        const caughtUp: Received = await connect(expired.seq);
        await waitUntil(() => caughtUp.notes.length === 1);
        expect(caughtUp.notes).toEqual([kept.seq]);
        expect(caughtUp.incomplete).toEqual([]);
    }, 15000);

    it('gives every message its own seq, however many are sent at once', async () => {
        const offset: number = await resolveNewestSeq();

        await Promise.all(Array.from({ length: 20 }, async () => await sendNote()));

        const sent: WebsocketMessage[] = await messageRepository().findAll({ where: { seq: { greaterThan: offset } }, acrossTenants: true });
        expect(sent.map(m => m.seq)).toEqual(Array.from({ length: 20 }, (_, i) => offset + i + 1));
    }, 15000);

    it('goes on from the messages it finds kept when it starts without a sequence', async () => {
        await sendNote();
        const newest: number = await resolveNewestSeq();
        await sequenceRepository().deleteAll({}, { acrossTenants: true });

        await server.reInit({ providers: resolveProviders(true) });
        baseUrl = await server.start();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
        await sendNote();

        expect(await resolveNewestSeq()).toBe(newest + 1);
    }, 30000);
});

describe('an application with websockets that does not say how long its messages are kept', () => {
    it('does not start', async () => {
        await expect(startTestServer({
            websocketControllers: [ReplayWsController],
            dataSources: [dataSourceClass],
            providers: resolveProviders(false)
        })).rejects.toThrow('ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT');
    }, 30000);
});