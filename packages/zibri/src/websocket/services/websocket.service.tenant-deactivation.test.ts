import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { HttpStatus } from '../../http/http-status.enum';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WebsocketController } from '../decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessage } from '../models/websocket-message.model';
import { WebsocketOptionsInput } from '../models/websocket-options.model';
import { type WebsocketServiceInterface } from './websocket-service.interface';

@WebsocketController({ allowOrphan: true, eventPrefix: 'deactivation-ws:' })
class DeactivationWsController {
    @WebsocketRoute('ping')
    ping(): string {
        return 'pong';
    }
}

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerTimeoutInMs: 5000,
    isAllowedToConnect: () => true
};

/**
 * How long a message that is not supposed to arrive is given to arrive anyway.
 */
const quietPeriodInMs: number = 150;

/**
 * A client and the events it received.
 */
type RecordingClient = {
    socket: Socket,
    received: Map<string, WebsocketMessage[]>
};

let server: StartedTestServer | undefined;
let baseUrl: string;
const clients: Socket[] = [];

function tenants(): TenantServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
}

function websockets(): WebsocketServiceInterface<SocketIOWebsocketConnection> {
    // eslint-disable-next-line typescript/no-unsafe-return
    return inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
}

/**
 * Creates a tenant and a member of it, and logs the member in.
 * @returns The tenant and the access token of the member.
 */
async function createMember(): Promise<{ tenantId: string, accessToken: string }> {
    const tenant: TestTenant = await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).create({ name: `tenant ${UUIDUtilities.generate()}` });
    const email: string = `${UUIDUtilities.generate()}@deactivation-ws.test`;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ password: 'secure123', userId: user.id });
    await tenants().runAs(tenant.id, async () => await inject(DefaultTestServerMembershipRepository)
        .create({ tenantId: tenant.id, userId: user.id, roles: [MemberRoles.USER] }));
    const authData: JwtAuthData<Roles> = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email, password: 'secure123' }, undefined);
    return { tenantId: tenant.id, accessToken: authData.accessToken.value };
}

async function connectClient(accessToken: string): Promise<RecordingClient> {
    const socket: Socket = io(baseUrl, { auth: { offset: 0 }, extraHeaders: { authorization: `Bearer ${accessToken}` }, autoConnect: false });
    clients.push(socket);
    const received: Map<string, WebsocketMessage[]> = new Map();
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
    await waitUntil(async () => (await websockets().getConnections()).some(c => c.id === socket.id));
    await new Promise(resolve => setTimeout(resolve, 50));
    return { socket, received };
}

async function broadcastIn(tenantId: string, event: string): Promise<void> {
    await tenants().runAs(tenantId, async () => await websockets().sendToAll({
        event,
        message: { ok: true, data: { event }, senderUserId: undefined, senderConnectionId: undefined },
        expectResponse: false,
        persist: false
    }));
}

async function ping(client: RecordingClient, tenantId: string, accessToken: string): Promise<unknown> {
    return await client.socket.timeout(5000).emitWithAck('deactivation-ws:ping', {
        headers: { 'x-tenant-id': tenantId, authorization: `Bearer ${accessToken}` }
    });
}

describe('WebsocketService - a deactivated tenant', () => {
    beforeAll(async () => {
        server = await startTestServer({
            websocketControllers: [DeactivationWsController],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, TestTenant], repositories: defaultTestServerRepositories })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        for (const client of clients.splice(0)) {
            client.disconnect();
        }
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('tells its connections, which keep their other tenants, and refuses messages naming it until it is reactivated', async () => {
        const { tenantId, accessToken } = await createMember();
        const client: RecordingClient = await connectClient(accessToken);
        expect(await ping(client, tenantId, accessToken)).toMatchObject({ ok: true, data: 'pong' });

        await tenants().deactivateTenant?.(tenantId);
        await waitUntil(() => Promise.resolve(client.received.has(WebsocketEvent.TENANT_DEACTIVATED)));

        // with a status, as every message the application sends has one, and its AsyncAPI document says so
        expect(client.received.get(WebsocketEvent.TENANT_DEACTIVATED)).toEqual([expect.objectContaining({ ok: true, status: HttpStatus.OK, data: { tenantId } })]);
        expect(client.socket.connected).toBe(true);
        expect(await ping(client, tenantId, accessToken)).toMatchObject({ ok: false, status: 403 });
        await broadcastIn(tenantId, 'while-deactivated');
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
        expect(client.received.has('while-deactivated')).toBe(false);

        await tenants().reactivateTenant?.(tenantId);
        await new Promise(resolve => setTimeout(resolve, 50));

        await broadcastIn(tenantId, 'reactivated');
        await waitUntil(() => Promise.resolve(client.received.has('reactivated')));
        expect(await ping(client, tenantId, accessToken)).toMatchObject({ ok: true, data: 'pong' });
    });

    it('tells its connections as well when the tenant is deactivated through its repository', async () => {
        const { tenantId, accessToken } = await createMember();
        const client: RecordingClient = await connectClient(accessToken);

        await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).updateById(tenantId, { deactivatedAt: new Date() });
        await waitUntil(() => Promise.resolve(client.received.has(WebsocketEvent.TENANT_DEACTIVATED)));

        await broadcastIn(tenantId, 'after-the-write');
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
        expect(client.received.has('after-the-write')).toBe(false);
    });

    it('leaves a deactivated tenant out of a connection made while it is', async () => {
        const { tenantId, accessToken } = await createMember();
        await tenants().deactivateTenant?.(tenantId);

        const client: RecordingClient = await connectClient(accessToken);
        await broadcastIn(tenantId, 'not-for-it');
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));

        expect(client.received.has('not-for-it')).toBe(false);
    });
});