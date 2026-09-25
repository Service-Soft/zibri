import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { SocketIOWebsocketConnection } from '../../../websocket/models/connection/socket-io-websocket-connection.model';
import { type WebsocketServiceInterface } from '../../../websocket/services/websocket-service.interface';
import { createTestDataSource, defaultTestServerEntities } from '../../test-server/create-test-data-source.function';
import { defaultTestValKeyEntities } from '../../test-server/create-test-val-key-data-source.function';

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
 * The valkey keyspace, fixed so that every instance publishes and subscribes on the same one.
 */
const valKeyPrefix: string = 'cluster-websocket';

@DataSource()
class ClusterWebsocketValKeyDataSource extends ValKeyDataSource {
    override options: ValKeyOptions = {
        host: 'localhost',
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
}

const options: StartTestServerOptions = {
    controllers: [ClusterWebsocketController],
    // this repository's own fixtures plus the mark table, the way every other suite here declares a
    // data source: importing the helper above registers JwtUser, and a registered entity no data
    // source declares is refused at boot
    dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, ClusterMark] }), ClusterWebsocketValKeyDataSource],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so all the defaults have to be kept here
    providers: [
        ...defaultClusterProviders,
        defineProvider({
            token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS,
            useFactory: () => ({
                timeoutInMs: Ms.SECOND * 5,
                handlerInMs: Ms.SECOND * 30,
                isAllowedToConnect: () => true,
                // without this a broadcast reaches only the clients of the instance that sent it
                adapterDataSource: ClusterWebsocketValKeyDataSource
            })
        })
    ]
};

export default options;