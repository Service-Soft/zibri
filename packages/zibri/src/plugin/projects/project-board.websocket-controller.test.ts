import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders } from '../../__testing__/test-server/providers';
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
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WebsocketController } from '../../websocket/decorators/websocket-controller.decorator';
import { type BaseWebsocketConnection } from '../../websocket/models/connection/base-websocket-connection.model';
import { WebsocketChannel } from '../../websocket/models/websocket-channel.model';
import { type WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { type WebsocketServiceInterface } from '../../websocket/services/websocket-service.interface';
import { PROJECT_BOARD_WEBSOCKET_EVENT, type ProjectBoardMessage } from './models/project-board-message.model';
import { ProjectBoardWebsocketController } from './project-board.websocket-controller';
import { Permissions, PlatformPermissions, projectsOptions, projectsTestEntities, projectsTestRoles, TenantRoles, TestProjectsController } from './projects.cases';
import { ZibriProjectsPlugin } from './projects.plugin';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';

/**
 * The live changes of a board, below `projects:`.
 */
@WebsocketController({ eventPrefix: 'projects:', allowOrphan: true })
class TestProjectBoardWebsocketController extends ProjectBoardWebsocketController {}

/**
 * How long a message that is not supposed to arrive is given to arrive anyway.
 */
const quietPeriodInMs: number = 300;

/**
 * Somebody logged in, with a socket that records what reaches it.
 */
type Subscriber = {
    /**
     * The user.
     */
    user: JwtUser,
    /**
     * Their access token.
     */
    accessToken: string,
    /**
     * Their socket.
     */
    socket: Socket,
    /**
     * The changes of boards that reached the socket.
     */
    received: ProjectBoardMessage[]
};

/**
 * What an event of the websocket answered.
 */
type WebsocketAnswerBody = {
    /**
     * Whether it went through.
     */
    ok: boolean,
    /**
     * Its status.
     */
    status: number
};

let server: StartedTestServer | undefined;
let baseUrl: string;
const tenantId: string = UUIDUtilities.generate();
const sockets: Socket[] = [];

describe('ProjectBoardWebsocketController', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                // without the invitations, which nothing here sends
                    entities: [...defaultTestServerEntities, ...projectsTestEntities.filter(entity => entity !== TestInvitation)],
                    repositories: defaultTestServerRepositories
                })
            ],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            controllers: [TestProjectsController],
            websocketControllers: [TestProjectBoardWebsocketController],
            plugins: [new ZibriProjectsPlugin()],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders(
                    { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                    projectsTestRoles
                ),
                defineProvider({ token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { ...projectsOptions, eventNames: {} } }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                    useValue: { messageRetentionInMs: Ms.DAY, timeoutInMs: 5000, handlerTimeoutInMs: 5000, isAllowedToConnect: () => true }
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        for (const socket of sockets.splice(0)) {
            socket.disconnect();
        }
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Creates a member of the tenant who logs in, and connects a socket of theirs.
     * @param tenantRoles - Their roles in the tenant.
     * @returns The subscriber, not subscribed to anything yet.
     */
    async function connect(tenantRoles: string[]): Promise<Subscriber> {
        const email: string = `${UUIDUtilities.generate().slice(0, 8)}@projects-ws.test`;
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository)
            .create({ tenantId, userId: user.id, roles: tenantRoles }));
        const authData: JwtAuthData<Roles> = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE)
            .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email, password: 'secure123' }, undefined);
        const accessToken: string = authData.accessToken.value;
        const socket: Socket = io(baseUrl, { extraHeaders: { authorization: `Bearer ${accessToken}` }, autoConnect: false });
        sockets.push(socket);
        const received: ProjectBoardMessage[] = [];
        socket.on(PROJECT_BOARD_WEBSOCKET_EVENT, (message: WebsocketMessage, ack?: () => void) => {
            // the change, as the plugin sent it
            received.push(message.data as ProjectBoardMessage);
            if (typeof ack === 'function') {
                ack();
            }
        });
        await new Promise<void>((resolve, reject) => {
            socket.once('connect', () => resolve());
            socket.once('connect_error', reject);
            socket.connect();
        });
        const websockets: WebsocketServiceInterface<BaseWebsocketConnection> = inject<WebsocketServiceInterface<BaseWebsocketConnection>>(
            ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE
        );
        await waitUntil(async () => (await websockets.getConnections()).some(c => c.id === socket.id));
        return { user, accessToken, socket, received };
    }

    async function subscribe(subscriber: Subscriber, projectId: string): Promise<WebsocketAnswerBody> {
        return await subscriber.socket.timeout(5000).emitWithAck('projects:subscribe', {
            headers: { 'x-tenant-id': tenantId, authorization: `Bearer ${subscriber.accessToken}` },
            body: { projectId }
        }) as WebsocketAnswerBody;
    }

    async function call<T>(caller: Subscriber, method: string, path: string, body?: object): Promise<T> {
        const res: Response = await fetch(`${baseUrl}/projects${path}`, {
            method,
            headers: {
                authorization: `Bearer ${caller.accessToken}`,
                'x-tenant-id': tenantId,
                ...body == undefined ? {} : { 'content-type': 'application/json' }
            },
            body: body == undefined ? undefined : JSON.stringify(body)
        });
        const text: string = await res.text();
        expect(res.status).toBeLessThan(300);
        // what the route answered, which the case typed
        return (text === '' ? undefined : JSON.parse(text)) as T;
    }

    function tasksCreated(subscriber: Subscriber, title: string): ProjectBoardMessage[] {
        return subscriber.received.filter(m => m.type === 'task-created' && m.task.title === title);
    }

    it('pushes the changes of a board to its subscribers who see it, and to nobody else', async () => {
        const manager: Subscriber = await connect([TenantRoles.MANAGER]);
        const guest: Subscriber = await connect([TenantRoles.GUEST]);
        const outsider: Subscriber = await connect([TenantRoles.GUEST]);
        const project: { id: string } = await call(manager, 'POST', '/', { name: 'Website' });
        const column: { id: string } = await call(manager, 'POST', `/${project.id}/columns`, { name: 'To do' });
        await call(manager, 'PUT', `/${project.id}/shares/${guest.user.id}`, { role: 'viewer' });

        expect(await subscribe(manager, project.id)).toMatchObject({ ok: true });
        expect(await subscribe(guest, project.id)).toMatchObject({ ok: true });
        expect(await subscribe(outsider, project.id)).toMatchObject({ ok: false, status: 404 });

        const task: { id: string } = await call(manager, 'POST', `/${project.id}/tasks`, { columnId: column.id, title: 'Write the texts' });
        await call(manager, 'POST', `/tasks/${task.id}/comments`, { text: 'By Friday' });

        await waitUntil(async () => await Promise.resolve(guest.received.some(m => m.type === 'comment-created')));
        expect(tasksCreated(manager, 'Write the texts')).toEqual([expect.objectContaining({ projectId: project.id, task: expect.objectContaining({ id: task.id }) })]);
        expect(tasksCreated(guest, 'Write the texts')).toHaveLength(1);
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
        expect(outsider.received).toEqual([]);
    });

    it('ends the subscription of a guest whose share ended, with the next change', async () => {
        const manager: Subscriber = await connect([TenantRoles.MANAGER]);
        const guest: Subscriber = await connect([TenantRoles.GUEST]);
        const project: { id: string } = await call(manager, 'POST', '/', { name: 'Shop' });
        const column: { id: string } = await call(manager, 'POST', `/${project.id}/columns`, { name: 'To do' });
        await call(manager, 'PUT', `/${project.id}/shares/${guest.user.id}`, { role: 'viewer' });
        await subscribe(manager, project.id);
        await subscribe(guest, project.id);
        await call(manager, 'POST', `/${project.id}/tasks`, { columnId: column.id, title: 'Before' });
        await waitUntil(async () => await Promise.resolve(tasksCreated(guest, 'Before').length === 1));

        await call(manager, 'DELETE', `/${project.id}/shares/${guest.user.id}`);
        await call(manager, 'POST', `/${project.id}/tasks`, { columnId: column.id, title: 'After' });

        await waitUntil(async () => await Promise.resolve(tasksCreated(manager, 'After').length === 1));
        await new Promise(resolve => setTimeout(resolve, quietPeriodInMs));
        expect(tasksCreated(guest, 'After')).toEqual([]);
        // and nothing of it is replayed to them, nor is their socket put back into it on a reconnect
        const channels: WebsocketChannel[] = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject<Repository<WebsocketChannel>>(
            repositoryTokenFor(WebsocketChannel)
        ).findAll({ where: { userIds: { includes: [guest.user.id] } } }));
        expect(channels).toEqual([]);
        expect(await subscribe(guest, project.id)).toMatchObject({ ok: false, status: 404 });
    });
});