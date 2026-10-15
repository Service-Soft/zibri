import type { Namespace } from 'socket.io';
import type { ClusterAdapter, ClusterMessage, ClusterResponse, Offset, ServerId } from 'socket.io-adapter';

import { DataSourceSubscription, PubSubDataSourceInterface } from '../data-source/data-sources/pub-sub-data-source.interface';
import { InternalError } from '../error-handling/internal-error.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { JsonUtilities } from '../utilities/json.utilities';
import { optionalPeer } from '../utilities/optional-peer.function';

/**
 * The channel instances talk to each other on.
 */
const WEBSOCKET_CHANNEL: string = 'zibri.websocket';

/**
 * What is put on the channel. The two kinds socket.io's cluster protocol distinguishes.
 */
type PublishedEnvelope = {
    /**
     * Which of the two callbacks the payload belongs to.
     */
    kind: 'message' | 'response',
    /**
     * The socket.io cluster payload.
     */
    payload: ClusterMessage | ClusterResponse,
    /**
     * Only set for a response, naming the instance that asked.
     */
    requesterUid?: ServerId
};

/**
 * Carries socket.io broadcasts between the instances of a deployment, over a data source.
 *
 * A socket belongs to the instance that accepted it. Without this, `io.to(room).emit(...)` reaches
 * only the clients that happen to be connected to the instance running the code - roughly one in N
 * of them - and nothing reports that the rest were missed.
 *
 * Built on socket.io's own ClusterAdapter, so the protocol (heartbeats, acknowledgements, fetching
 * sockets across instances, filtering out an instance's own messages by uid) is socket.io's rather
 * than reimplemented here. All this adds is the transport.
 */
export type DataSourceWebsocketAdapter = ClusterAdapter;

/**
 * How the adapter is built once its base class is available.
 */
export type DataSourceWebsocketAdapterConstructor = new (
    nsp: Namespace,
    dataSource: PubSubDataSourceInterface,
    logger: LoggerInterface
) => DataSourceWebsocketAdapter;

/**
 * The class, once it has been built.
 */
let builtAdapterClass: DataSourceWebsocketAdapterConstructor | undefined;

/**
 * Builds the adapter class on top of socket.io's own.
 *
 * A class cannot extend a base it has not loaded, so writing this as a plain declaration made
 * `socket.io-adapter` a package every consumer needed - the barrel exports this module, so the base
 * class was resolved by an application that serves no websockets at all, next to the `socket.io` it
 * belongs to being declared optional.
 *
 * Called where the adapter is set up, while the application starts, so a deployment that named an
 * adapter data source without installing socket.io finds out on the way up.
 * @returns The constructor, built once and kept.
 * @throws If socket.io-adapter is not installed.
 */
export function dataSourceWebsocketAdapterClass(): DataSourceWebsocketAdapterConstructor {
    if (builtAdapterClass != undefined) {
        return builtAdapterClass;
    }

    const base: typeof ClusterAdapter = optionalPeer<typeof import('socket.io-adapter')>(
        'socket.io-adapter',
        'Carrying websocket broadcasts between instances'
    ).ClusterAdapter;

    builtAdapterClass = class DataSourceWebsocketAdapter extends base {
        private subscription: DataSourceSubscription | undefined;

        constructor(
            nsp: Namespace,
            private readonly dataSource: PubSubDataSourceInterface,
            private readonly logger: LoggerInterface
        ) {
            super(nsp);
            // the constructor cannot wait, so the subscription is started alongside it. Messages
            // published before it is up are missed, which is the same window any adapter has while
            // connecting.
            void this.listen();
        }

        override async close(): Promise<void> {
            await this.subscription?.unsubscribe();
            this.subscription = undefined;
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        protected async doPublish(message: ClusterMessage): Promise<Offset> {
            await this.publishEnvelope({ kind: 'message', payload: message });
            // the offset is only used by connection state recovery, which needs the transport to
            // hand out monotonic ids. This one cannot, so it reports none and recovery falls back
            // to what a single instance would do.
            return '';
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        protected async doPublishResponse(requesterUid: ServerId, response: ClusterResponse): Promise<void> {
            await this.publishEnvelope({ kind: 'response', payload: response, requesterUid });
        }

        /**
         * Puts one envelope on the channel.
         * @param envelope - What to send.
         */
        private async publishEnvelope(envelope: PublishedEnvelope): Promise<void> {
            try {
                // the packet holds the message as it was sent, bigints included, so it is written
                // the way the encoder writes it for the clients of this instance
                await this.dataSource.publish(WEBSOCKET_CHANNEL, JsonUtilities.stringify(envelope));
            }
            catch (error) {
                // swallowing it would mean the other instances silently never hear about this broadcast
                this.logger.error(new InternalError('could not publish a websocket message to the other instances', {
                    cause: error
                }));
            }
        }

        /**
         * Starts delivering what the other instances publish into socket.io's cluster protocol.
         */
        private async listen(): Promise<void> {
            try {
                this.subscription = await this.dataSource.subscribe(WEBSOCKET_CHANNEL, raw => this.receive(raw));
            }
            catch (error) {
                this.logger.error(new InternalError('could not subscribe to websocket messages of the other instances', {
                    cause: error
                }));
            }
        }

        /**
         * Hands one received envelope to socket.io.
         *
         * ClusterAdapter drops anything carrying this instance's own uid, so publishing to a channel
         * that also delivers back to the publisher is fine.
         * @param raw - The serialized envelope.
         */
        private receive(raw: string): void {
            let envelope: PublishedEnvelope;
            try {
                envelope = JsonUtilities.parse(raw);
            }
            catch {
                this.logger.warn('received a websocket message that could not be read, ignoring it');
                return;
            }

            if (envelope.kind === 'message') {
                this.onMessage(envelope.payload as ClusterMessage);
                return;
            }
            this.onResponse(envelope.payload as ClusterResponse);
        }
    };

    return builtAdapterClass;
}