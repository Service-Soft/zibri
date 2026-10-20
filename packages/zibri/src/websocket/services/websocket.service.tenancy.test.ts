import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../../__testing__/wait-until.function.ts';
import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator.ts';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { WebsocketController } from '../decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../decorators/websocket-route.decorator.ts';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model.ts';
import { WebsocketAnswer } from '../models/websocket-answer.model.ts';
import { WebsocketChannel } from '../models/websocket-channel.model.ts';
import { WebsocketMessage } from '../models/websocket-message.model.ts';
import { WebsocketOptionsInput } from '../models/websocket-options.model.ts';

@WebsocketController({ allowOrphan: true, eventPrefix: 'tenancy-ws:' })
class TenancyWsController {
    @WebsocketRoute('ping')
    ping(): string {
        return 'pong';
    }
}

// in memory, so that what the websockets do across tenants can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerInMs: 5000,
    isAllowedToConnect: () => true
};

/**
 * How long a message that is not supposed to arrive is given to arrive anyway.
 */
const quietPeriodInMs: number = 150;

let server: StartedTestServer;
let baseUrl: string;
let wsService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
let tenants: TenantServiceInterface;
let channels: Repository<WebsocketChannel>;
let messages: Repository<WebsocketMessage>;
let memberships: DefaultTestServerMembershipRepository;
const clients: Socket[] = [];

/**
 * Creates a user who can log in, and logs them in.
 * @param name - What sets the user's email apart.
 * @returns The user and their access token.
 */
async function logIn(name: string): Promise<{ user: JwtUser, accessToken: string }> {
    const email: string = `${name}-${UUIDUtilities.generate()}@tenancy-ws.test`;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ password: 'secure123', userId: user.id });
    const authData: JwtAuthData<Roles> = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email, password: 'secure123' }, undefined);
    return { user, accessToken: authData.accessToken.value };
}

/**
 * Makes a user a member of a tenant.
 * @param userId - The user.
 * @param tenantId - The tenant.
 * @param transaction - The transaction to write it in, if any.
 * @returns The membership.
 */
async function addMember(userId: string, tenantId: string, transaction?: Transaction): Promise<TestMembership> {
    return await tenants.runAs(tenantId, async () => await memberships.create({ tenantId, userId, roles: [Roles.USER] }, { transaction }));
}

/**
 * A client and everything it received, by event.
 */
type RecordingClient = {
    /**
     * The socket.
     */
    socket: Socket,
    /**
     * What arrived, under the event it arrived as.
     */
    received: Map<string, WebsocketMessage[]>
};

/**
 * Opens a socket that records every event it receives, and acknowledges each.
 * @param accessToken - Who the socket connects as, if anyone.
 * @param auth - What the client sends to authenticate, which holds the sequence number of the last
 * message it saw as `offset`.
 * @returns The connected client.
 */
async function connectClient(accessToken?: string, auth: Record<string, unknown> = { offset: 0 }): Promise<RecordingClient> {
    const socket: Socket = io(baseUrl, {
        auth,
        extraHeaders: accessToken == undefined ? {} : { authorization: `Bearer ${accessToken}` },
        autoConnect: false
    });
    clients.push(socket);
    const received: Map<string, WebsocketMessage[]> = new Map();
    // registered before connecting, so that what is replayed while connecting is recorded too
    socket.onAny((event: string, message: WebsocketMessage, ack?: () => void) => {
        received.set(event, [...received.get(event) ?? [], message]);
        if (typeof ack === 'function') {
            ack();
        }
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
    });
    // until the server has put the connection into its rooms
    await waitUntil(async () => (await wsService.getConnections()).some(c => c.id === socket.id));
    await new Promise(resolve => setTimeout(resolve, 50));
    return { socket, received };
}

/**
 * Reads the server side of a client's connection.
 * @param client - The client.
 * @returns Its connection.
 */
async function findConnection(client: RecordingClient): Promise<SocketIOWebsocketConnection> {
    return await wsService.findConnectionById(client.socket.id ?? '');
}

/**
 * Sends a message to every connection the current tenant reaches.
 * @param event - The event to send it as.
 * @param persist - Whether the message is stored for clients that reconnect later.
 */
async function broadcast(event: string, persist: boolean = false): Promise<void> {
    await wsService.sendToAll({
        event,
        message: { ok: true, data: { event }, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: false,
        persist
    });
}

/**
 * Sends a message to the connections in a channel, as the current tenant.
 * @param channel - The channel.
 * @param event - The event to send it as.
 */
async function sendToChannel(channel: WebsocketChannel, event: string): Promise<void> {
    await wsService.sendToChannel({
        channelId: channel.id,
        event,
        message: { ok: true, data: { event }, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: false,
        persist: false
    });
}

/**
 * Sends a message to the connections in a channel and waits for each to answer, as the current tenant.
 * @param channel - The channel.
 * @param event - The event to send it as.
 * @returns The ids of the connections that were asked.
 */
async function askChannel(channel: WebsocketChannel, event: string): Promise<string[]> {
    const answers: WebsocketAnswer[] = await wsService.sendToChannel({
        channelId: channel.id,
        event,
        message: { ok: true, data: { event }, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: true,
        persist: false
    });
    return answers.map(a => a.connectionId);
}

/**
 * Waits for what may arrive, then reports whether the client received the event.
 * @param client - The client.
 * @param event - The event.
 * @returns Whether it arrived.
 */
async function hasReceived(client: RecordingClient, event: string): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
    return client.received.has(event);
}

beforeAll(async () => {
    server = await startTestServer({
        websocketControllers: [TenancyWsController],
        dataSources: [dataSourceClass],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
        ]
    });
    baseUrl = await server.start();
    // eslint-disable-next-line typescript/no-unsafe-assignment
    wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
    tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    channels = inject(repositoryTokenFor(WebsocketChannel));
    messages = inject(repositoryTokenFor(WebsocketMessage));
    memberships = inject(DefaultTestServerMembershipRepository);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

afterEach(async () => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
    await new Promise(resolve => setTimeout(resolve, 50));
});

describe('websockets across tenants', () => {
    it('keeps the channels of two tenants apart, also when they have the same name', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        const ofA: WebsocketChannel = await tenants.runAs(tenantA, async () => await channels.create({ name: 'general', userIds: [] }));
        const ofB: WebsocketChannel = await tenants.runAs(tenantB, async () => await channels.create({ name: 'general', userIds: [] }));
        expect([ofA.tenantId, ofB.tenantId]).toEqual([tenantA, tenantB]);

        const inA: RecordingClient = await connectClient();
        const inB: RecordingClient = await connectClient();
        await tenants.runAs(tenantA, async () => await wsService.joinChannel(await findConnection(inA), ofA.id));
        await tenants.runAs(tenantB, async () => await wsService.joinChannel(await findConnection(inB), ofB.id));

        await tenants.runAs(tenantB, async () => await wsService.sendToChannel({
            channelId: ofB.id,
            event: 'channel-of-b',
            message: { ok: true, data: {}, senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: false,
            persist: false
        }));

        expect(await hasReceived(inB, 'channel-of-b')).toBe(true);
        expect(await hasReceived(inA, 'channel-of-b')).toBe(false);
    });

    it('lets a member of a tenant join and leave a channel every tenant shares', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const shared: WebsocketChannel = await channels.create({ name: 'lobby', userIds: [] });
        const member: { user: JwtUser, accessToken: string } = await logIn('lobby-member');
        await addMember(member.user.id, tenantA);
        const client: RecordingClient = await connectClient(member.accessToken);

        // a channel of no tenant is changed across tenants only, which joining it from inside one does
        await tenants.runAs(tenantA, async () => await wsService.joinChannel(await findConnection(client), shared.id));
        expect((await channels.findById(shared.id)).userIds).toEqual([member.user.id]);

        await tenants.runAs(tenantA, async () => await wsService.leaveChannel(await findConnection(client), shared.id));
        expect((await channels.findById(shared.id)).userIds).toEqual([]);
    });

    it('sends a broadcast in a tenant to the connections of its members, and one outside every tenant to all', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const memberOfA: { user: JwtUser, accessToken: string } = await logIn('member-of-a');
        const memberOfB: { user: JwtUser, accessToken: string } = await logIn('member-of-b');
        await addMember(memberOfA.user.id, tenantA);
        await addMember(memberOfB.user.id, UUIDUtilities.generate());

        const a: RecordingClient = await connectClient(memberOfA.accessToken);
        const b: RecordingClient = await connectClient(memberOfB.accessToken);
        const anonymous: RecordingClient = await connectClient();

        await tenants.runAs(tenantA, async () => await broadcast('to-a'));
        expect(await hasReceived(a, 'to-a')).toBe(true);
        expect(await hasReceived(b, 'to-a')).toBe(false);
        expect(await hasReceived(anonymous, 'to-a')).toBe(false);

        await broadcast('to-everyone');
        expect(await Promise.all([a, b, anonymous].map(async c => await hasReceived(c, 'to-everyone')))).toEqual([true, true, true]);
    });

    it('moves a connection into the broadcasts of a tenant once its user becomes a member, and out once the membership is gone', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const joining: { user: JwtUser, accessToken: string } = await logIn('joining');
        const client: RecordingClient = await connectClient(joining.accessToken);

        await tenants.runAs(tenantA, async () => await broadcast('before-joining'));
        expect(await hasReceived(client, 'before-joining')).toBe(false);

        // in a transaction, so that it is the commit the connection follows rather than the write
        const transaction: Transaction = await memberships.dataSource.startTransaction();
        const membership: TestMembership = await addMember(joining.user.id, tenantA, transaction);
        await tenants.runAs(tenantA, async () => await broadcast('before-the-commit'));
        expect(await hasReceived(client, 'before-the-commit')).toBe(false);
        await transaction.commit();

        await tenants.runAs(tenantA, async () => await broadcast('after-joining'));
        expect(await hasReceived(client, 'after-joining')).toBe(true);

        await tenants.runAs(tenantA, async () => await memberships.deleteById(membership.id));
        await tenants.runAs(tenantA, async () => await broadcast('after-leaving'));
        expect(await hasReceived(client, 'after-leaving')).toBe(false);
    });

    it('takes a connection out of the broadcasts of a tenant while its membership there is deactivated', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const pausing: { user: JwtUser, accessToken: string } = await logIn('pausing');
        await addMember(pausing.user.id, tenantA);
        const deactivated: RecordingClient = await connectClient(pausing.accessToken);

        await tenants.runAs(tenantA, async () => await memberships.updateDeactivatedAt(pausing.user.id, new Date(), undefined));
        await tenants.runAs(tenantA, async () => await broadcast('while-deactivated'));
        expect(await hasReceived(deactivated, 'while-deactivated')).toBe(false);

        // nor put into them when connecting while it is
        const reconnected: RecordingClient = await connectClient(pausing.accessToken);
        await tenants.runAs(tenantA, async () => await broadcast('connected-while-deactivated'));
        expect(await hasReceived(reconnected, 'connected-while-deactivated')).toBe(false);

        // null rather than undefined: it clears the column
        // eslint-disable-next-line unicorn/no-null
        await tenants.runAs(tenantA, async () => await memberships.updateDeactivatedAt(pausing.user.id, null, undefined));
        await tenants.runAs(tenantA, async () => await broadcast('after-reactivation'));
        expect(await hasReceived(deactivated, 'after-reactivation')).toBe(true);
    });

    it('takes a connection out of the channels of a tenant once its user stops being a member there, and back once they are one again', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const member: { user: JwtUser, accessToken: string } = await logIn('channel-member');
        const membership: TestMembership = await addMember(member.user.id, tenantA);
        const team: WebsocketChannel = await tenants.runAs(tenantA, async () => await channels.create({ name: 'team', userIds: [] }));
        const client: RecordingClient = await connectClient(member.accessToken);
        await tenants.runAs(tenantA, async () => await wsService.joinChannel(await findConnection(client), team.id));

        await tenants.runAs(tenantA, async () => await memberships.deleteById(membership.id));
        await tenants.runAs(tenantA, async () => await sendToChannel(team, 'after-leaving'));
        expect(await hasReceived(client, 'after-leaving')).toBe(false);
        // nor asked for an answer
        expect(await tenants.runAs(tenantA, async () => await askChannel(team, 'asked-after-leaving'))).toEqual([]);

        // the channel is still theirs, as it would be on a reconnect once they are a member again
        await addMember(member.user.id, tenantA);
        await tenants.runAs(tenantA, async () => await sendToChannel(team, 'after-rejoining'));
        expect(await hasReceived(client, 'after-rejoining')).toBe(true);
    });

    it('forgets a closed connection in the channels it joined', async () => {
        const lobby: WebsocketChannel = await channels.create({ name: `closing-${UUIDUtilities.generate()}`, userIds: [] });
        const client: RecordingClient = await connectClient();
        await wsService.joinChannel(await findConnection(client), lobby.id);
        const closedId: string | undefined = client.socket.id;

        client.socket.disconnect();
        await waitUntil(async () => !(await wsService.getConnections()).some(c => c.id === closedId));

        // the closed one was asked anyway, and waited for until the timeout, before it was reported
        expect(await askChannel(lobby, 'asked-after-closing')).toEqual([]);
    }, 15000);

    it('takes the connections of a deleted user out of the broadcasts of every tenant', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const leaving: { user: JwtUser, accessToken: string } = await logIn('leaving');
        await addMember(leaving.user.id, tenantA);
        const client: RecordingClient = await connectClient(leaving.accessToken);

        // deleting the user deletes their memberships with them, in the same transaction
        await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).deleteById(leaving.user.id);

        await tenants.runAs(tenantA, async () => await broadcast('after-deletion'));
        expect(await hasReceived(client, 'after-deletion')).toBe(false);
    });

    it('stores each message in the tenant it was sent in, numbered across every tenant', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();

        await tenants.runAs(tenantA, async () => await broadcast('numbered-in-a', true));
        await tenants.runAs(tenantB, async () => await broadcast('numbered-in-b', true));

        const stored: WebsocketMessage[] = await messages.findAll({
            where: { event: { oneOf: ['numbered-in-a', 'numbered-in-b'] } },
            acrossTenants: true
        });
        const inA: WebsocketMessage | undefined = stored.find(m => m.event === 'numbered-in-a');
        const inB: WebsocketMessage | undefined = stored.find(m => m.event === 'numbered-in-b');
        expect([inA?.tenantId, inB?.tenantId]).toEqual([tenantA, tenantB]);
        // one sequence, so a client reading the messages of several tenants never sees a number twice
        expect(Number(inB?.seq)).toBeGreaterThan(Number(inA?.seq));
    });

    it('replays to a reconnecting user what they missed in the tenants they are a member of, and nothing of the others', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        const returning: { user: JwtUser, accessToken: string } = await logIn('returning');
        await addMember(returning.user.id, tenantA);
        const [last] = await messages.findAll({ order: { seq: 'DESC' }, take: 1, acrossTenants: true });

        await tenants.runAs(tenantA, async () => await broadcast('missed-in-a', true));
        await tenants.runAs(tenantB, async () => await broadcast('missed-in-b', true));
        await broadcast('missed-everywhere', true);

        const client: RecordingClient = await connectClient(returning.accessToken, { offset: Number(last?.seq ?? 0) });
        await waitUntil(() => client.received.has('missed-everywhere'));
        expect(client.received.has('missed-in-a')).toBe(true);
        expect(client.received.has('missed-in-b')).toBe(false);
    });

    it('puts a connection that sends no offset into the broadcasts of its tenants and the channels of its user, and replays it nothing', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const newcomer: { user: JwtUser, accessToken: string } = await logIn('newcomer');
        await addMember(newcomer.user.id, tenantA);
        const channel: WebsocketChannel = await tenants.runAs(tenantA, async () => await channels.create({ name: 'news', userIds: [newcomer.user.id] }));
        await tenants.runAs(tenantA, async () => await broadcast('before-connecting', true));

        // the way socket.io documents connecting: nothing in auth
        const client: RecordingClient = await connectClient(newcomer.accessToken, {});

        await tenants.runAs(tenantA, async () => await broadcast('to-a-without-offset'));
        await tenants.runAs(tenantA, async () => await sendToChannel(channel, 'to-channel-without-offset'));
        expect(await hasReceived(client, 'to-a-without-offset')).toBe(true);
        expect(await hasReceived(client, 'to-channel-without-offset')).toBe(true);
        expect(await hasReceived(client, 'before-connecting')).toBe(false);
    });

    it.each([
        ['text', 'last'],
        ['a negative number', -1],
        ['a fraction', 1.5]
    ])('refuses a connection whose offset is %s', async (_, offset) => {
        await expect(connectClient(undefined, { offset })).rejects.toThrow('The offset has to be a whole number of at least 0.');
    });
});