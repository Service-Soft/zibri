import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type WebsocketServiceInterface } from './websocket-service.interface.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../../__testing__/wait-until.function.ts';
import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { FederatedSession } from '../../auth/authenticators/federated/federated-session.model.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator.ts';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy.ts';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model.ts';
import { CreatedApiKey } from '../../auth/strategies/api-key/created-api-key.model.ts';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { CredentialReusedError } from '../../error-handling/errors/credential-reused.error.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { WebsocketController } from '../decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../decorators/websocket-route.decorator.ts';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model.ts';

@WebsocketController({ allowOrphan: true, eventPrefix: 'ended-logins:' })
class EndedLoginsWsController {
    @WebsocketRoute('ping')
    ping(): string {
        return 'pong';
    }
}

/**
 * How long an access token lasts here: short enough to watch one expire, long enough for every other
 * case to be over before its token does.
 */
const accessTokenExpiresInMs: number = 3000;

/**
 * How long a socket that is supposed to stay open is watched for closing anyway.
 */
const quietPeriodInMs: number = 300;

let server: StartedTestServer;
let baseUrl: string;
let wsService: WebsocketServiceInterface<SocketIOWebsocketConnection>;
let authService: AuthServiceInterface;
const sockets: Socket[] = [];

/**
 * A user, logged in.
 */
type LoggedIn = {
    /**
     * The user.
     */
    user: JwtUser,
    /**
     * What the login handed out.
     */
    authData: JwtAuthData<Roles>
};

/**
 * Creates a user who can log in.
 * @returns The user, with the email and password they log in with.
 */
async function createUser(): Promise<JwtUser> {
    const email: string = `ended-${UUIDUtilities.generate()}@ended-logins.test`;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ password: 'secure123', userId: user.id });
    return user;
}

/**
 * Logs a user in.
 * @param user - Who logs in.
 * @returns The user and what the login handed out.
 */
async function logIn(user: JwtUser): Promise<LoggedIn> {
    const authData: JwtAuthData<Roles> = await authService
        .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email: user.email, password: 'secure123' }, undefined);
    return { user, authData };
}

/**
 * Opens a socket with the given headers, once the server has taken it in.
 * @param headers - The credential the socket connects with.
 * @returns The connected socket.
 */
async function connect(headers: Record<string, string>): Promise<Socket> {
    const socket: Socket = io(baseUrl, { auth: { offset: 0 }, extraHeaders: headers, autoConnect: false, reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
    });
    await waitUntil(async () => (await wsService.getConnections()).some(c => c.id === socket.id));
    return socket;
}

/**
 * Opens a socket as a login.
 * @param login - Who connects.
 * @returns The connected socket.
 */
async function connectAs(login: LoggedIn): Promise<Socket> {
    return await connect({ authorization: `Bearer ${login.authData.accessToken.value}` });
}

/**
 * Waits for a socket to be closed by the server.
 * @param socket - The socket.
 * @param withinMs - How long to wait.
 * @returns Whether the server closed it in that time.
 */
async function isClosedWithin(socket: Socket, withinMs: number): Promise<boolean> {
    if (!socket.connected) {
        return true;
    }
    return await new Promise<boolean>(resolve => {
        const timeout: NodeJS.Timeout = setTimeout(() => resolve(false), withinMs);
        socket.once('disconnect', () => {
            clearTimeout(timeout);
            resolve(true);
        });
    });
}

describe('a socket whose login has ended', () => {
    beforeAll(async () => {
        server = await startTestServer({
            websocketControllers: [EndedLoginsWsController],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ApiKey] })],
            authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
                    useValue: { messageRetentionInMs: Ms.DAY, timeoutInMs: 5000, handlerInMs: 5000, isAllowedToConnect: () => true }
                }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
                    useValue: { accessTokenKey: 'test-access-token-secret', refreshTokenSecret: 'test-refresh-token-secret', accessTokenExpiresInMs }
                }),
                // so that a logout ends the access token as well, which is what a socket can follow:
                // under `onExpiry` the token keeps working over http, and the socket rightly with it
                defineProvider({ token: ZIBRI_DI_TOKENS.ACCESS_TOKEN_REVOCATION, useValue: 'immediately' })
            ]
        });
        baseUrl = await server.start();
        // eslint-disable-next-line typescript/no-unsafe-assignment
        wsService = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
        authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(() => {
        for (const socket of sockets.splice(0)) {
            socket.disconnect();
        }
    });

    it('is closed once its user is deactivated', async () => {
        const login: LoggedIn = await logIn(await createUser());
        const socket: Socket = await connectAs(login);
        const bystander: Socket = await connectAs(await logIn(await createUser()));

        await authService.deactivateUser(login.user.id, undefined);

        expect(await isClosedWithin(socket, 2000)).toBe(true);
        // the control: somebody else's socket stays where it is
        expect(await isClosedWithin(bystander, quietPeriodInMs)).toBe(false);
    });

    it('is closed only once the transaction that ended it commits', async () => {
        const login: LoggedIn = await logIn(await createUser());
        const socket: Socket = await connectAs(login);
        const transaction: Transaction = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).dataSource.startTransaction();

        await authService.deactivateUser(login.user.id, transaction);
        // a deactivation that is rolled back never happened, and one not yet committed may still be
        const closedBeforeCommit: boolean = await isClosedWithin(socket, quietPeriodInMs);
        await transaction.commit();

        expect(closedBeforeCommit).toBe(false);
        expect(await isClosedWithin(socket, 2000)).toBe(true);
    });

    it('is closed when its login logs out, while another login of the same user stays connected', async () => {
        const user: JwtUser = await createUser();
        const phone: LoggedIn = await logIn(user);
        const laptop: LoggedIn = await logIn(user);
        const phoneSocket: Socket = await connectAs(phone);
        const laptopSocket: Socket = await connectAs(laptop);

        await authService.logout(JwtAuthStrategy, { refreshToken: phone.authData.refreshToken.value });

        expect(await isClosedWithin(phoneSocket, 2000)).toBe(true);
        expect(await isClosedWithin(laptopSocket, quietPeriodInMs)).toBe(false);
    });

    it('is closed when the access token it connected with is revoked', async () => {
        const login: LoggedIn = await logIn(await createUser());
        const socket: Socket = await connectAs(login);

        await inject(JwtAuthStrategy<Roles>).revokeToken(login.authData.accessToken.value);

        expect(await isClosedWithin(socket, 2000)).toBe(true);
    });

    it('is closed when a spent refresh token of its login is presented again', async () => {
        const login: LoggedIn = await logIn(await createUser());
        const socket: Socket = await connectAs(login);
        const strategy: JwtAuthStrategy<Roles> = inject(JwtAuthStrategy<Roles>);
        const refresh: Transaction = await strategy.startTransaction();
        await authService.refreshLogin(JwtAuthStrategy<Roles>, { refreshToken: login.authData.refreshToken.value, transaction: refresh });
        await refresh.commit();

        // the token the refresh above spent, presented by whoever else holds it
        const reuse: Transaction = await strategy.startTransaction();
        await expect(authService.refreshLogin(JwtAuthStrategy<Roles>, { refreshToken: login.authData.refreshToken.value, transaction: reuse }))
            .rejects.toThrow(CredentialReusedError);
        await reuse.commit();

        expect(await isClosedWithin(socket, 2000)).toBe(true);
    });

    it('is closed when the provider ends the session its login came from', async () => {
        const user: JwtUser = await createUser();
        const federatedSession: FederatedSession = {
            provider: 'ended-logins-idp',
            subjectKey: UUIDUtilities.generate(),
            sessionKey: UUIDUtilities.generate(),
            logout: undefined
        };
        const authData: JwtAuthData<Roles> = await inject(JwtAuthStrategy<Roles>)
            .startLogin({ user, authenticatedAt: new Date(), federatedSession }, undefined);
        const socket: Socket = await connectAs({ user, authData });
        const otherLogin: Socket = await connectAs(await logIn(user));

        await authService.endFederatedLogins(federatedSession, undefined);

        expect(await isClosedWithin(socket, 2000)).toBe(true);
        expect(await isClosedWithin(otherLogin, quietPeriodInMs)).toBe(false);
    });

    it('is closed when every login of its user is ended', async () => {
        const login: LoggedIn = await logIn(await createUser());
        const socket: Socket = await connectAs(login);

        await authService.endLogins(login.user.id, undefined);

        expect(await isClosedWithin(socket, 2000)).toBe(true);
    });

    it('is closed when the api key it connected with is revoked', async () => {
        const user: JwtUser = await createUser();
        const created: CreatedApiKey = await authService.createApiKey(
            user.id,
            { name: 'socket', roles: [Roles.USER], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );
        const socket: Socket = await connect({ 'x-api-key': created.key });

        await authService.revokeApiKey(user.id, created.apiKey.id, undefined);

        expect(await isClosedWithin(socket, 2000)).toBe(true);
    });

    it('is closed once the access token it connected with expires', async () => {
        const socket: Socket = await connectAs(await logIn(await createUser()));

        // nothing ends the login: the token simply stops being accepted, and nothing else would say so
        expect(await isClosedWithin(socket, accessTokenExpiresInMs + 3000)).toBe(true);
    }, 15000);
});