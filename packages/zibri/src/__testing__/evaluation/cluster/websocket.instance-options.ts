import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../../auth/authenticators/password/password.authenticator';
import { JwtAuthData } from '../../../auth/strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../../auth/strategies/jwt/jwt.auth-strategy';
import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { SocketIOWebsocketConnection } from '../../../websocket/models/connection/socket-io-websocket-connection.model';
import { WebsocketAnswer } from '../../../websocket/models/websocket-answer.model';
import { type WebsocketServiceInterface } from '../../../websocket/services/websocket-service.interface';
import { JwtUser } from '../../mocks/entities/jwt-user.entity';
import { Roles } from '../../mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../../test-server/create-test-data-source.function';
import { defaultTestValKeyEntities } from '../../test-server/create-test-val-key-data-source.function';
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../../test-server/membership-repository';
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../../test-server/user-repository'; // this import is needed so that the DI system can pick up the user repository.

/**
 * What every instance of the websocket cluster boots with.
 *
 * Two data sources: postgres for the entities, and valkey for carrying broadcasts between the
 * instances. Like every instance options module this is imported by the parent as well, so nothing
 * at the top level may assume it is running inside an instance.
 */

/**
 * The event clients listen for.
 */
export const clusterBroadcastEvent: string = 'cluster-broadcast';

/**
 * The event clients are asked to answer.
 */
export const clusterAskedEvent: string = 'cluster-asked';

/**
 * A user the parent can connect as.
 */
export type ClusterLogin = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * Their access token.
     */
    accessToken: string
};

/**
 * The valkey keyspace, fixed so that every instance publishes and subscribes on the same one.
 */
const valKeyPrefix: string = 'cluster-websocket';

@DataSource()
class ClusterWebsocketValKeyDataSource extends ValKeyDataSource {
    override options: ValKeyOptions = {
        host: 'localhost',
        useTLS: false,
        keyPrefix: valKeyPrefix
    };
    entities: Newable<BaseEntity>[] = defaultTestValKeyEntities;
}

/**
 * Lets the parent make one specific instance broadcast.
 */
@Controller('/cluster-websocket')
class ClusterWebsocketController {
    /**
     * Broadcasts to every connected client of the whole deployment.
     */
    @Post('/broadcast')
    async broadcast(): Promise<void> {
        // the token is typed WebsocketServiceInterface<any>, so naming the connection type here is
        // a narrowing the compiler cannot check. Same suppression the framework's own test uses.
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const websocketService: WebsocketServiceInterface<SocketIOWebsocketConnection> = inject(
            ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE
        );

        await websocketService.sendToAll({
            event: clusterBroadcastEvent,
            message: {
                ok: true,
                data: { from: clusterInstanceId() },
                senderUserId: undefined,
                senderConnectionId: undefined
            },
            expectResponse: false,
            persist: false
        });
    }

    /**
     * Broadcasts values json has no form of its own for.
     */
    @Post('/broadcast-values')
    async broadcastValues(): Promise<void> {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const websocketService: WebsocketServiceInterface<SocketIOWebsocketConnection> = inject(
            ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE
        );

        await websocketService.sendToAll({
            event: clusterBroadcastEvent,
            message: {
                ok: true,
                data: { count: 2n ** 64n, at: new Date('2026-01-02T03:04:05.000Z') },
                senderUserId: undefined,
                senderConnectionId: undefined
            },
            expectResponse: false,
            persist: false
        });
    }

    /**
     * Asks every connected client of the whole deployment to answer.
     * @returns What they answered.
     */
    @Post('/ask-everyone')
    async askEveryone(): Promise<WebsocketAnswer[]> {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const websocketService: WebsocketServiceInterface<SocketIOWebsocketConnection> = inject(
            ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE
        );

        return await websocketService.sendToAll({
            event: clusterAskedEvent,
            message: { ok: true, data: {}, senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: true,
            persist: false
        });
    }

    /**
     * Creates a user and logs them in, so a client can connect as them on any instance.
     * @returns The user and their access token.
     */
    @Post('/login')
    async login(): Promise<ClusterLogin> {
        const email: string = `cluster-${UUIDUtilities.generate()}@cluster-websocket.test`;
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ password: 'secure123', userId: user.id });
        const authData: JwtAuthData<Roles> = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE)
            .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email, password: 'secure123' }, undefined);
        return { userId: user.id, accessToken: authData.accessToken.value };
    }

    /**
     * Deactivates a user from this instance.
     * @param userId - The user.
     */
    @Post('/deactivate/:userId')
    async deactivate(@Param.path('userId') userId: string): Promise<void> {
        await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE).deactivateUser(userId, undefined);
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterWebsocketController],
    authStrategies: [JwtAuthStrategy],
    // this repository's own fixtures plus the mark table, the way every other suite here declares a
    // data source: importing the helper above registers JwtUser, and a registered entity no data
    // source declares is refused at boot
    dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, ClusterMark] }), ClusterWebsocketValKeyDataSource],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so all the defaults have to be kept here
    providers: [
        ...defaultClusterProviders,
        defineProvider({
            token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
            useFactory: () => ({
                messageRetentionInMs: Ms.DAY,
                // without this a broadcast reaches only the clients of the instance that sent it
                adapterDataSource: ClusterWebsocketValKeyDataSource
            })
        })
    ]
};

export default options;