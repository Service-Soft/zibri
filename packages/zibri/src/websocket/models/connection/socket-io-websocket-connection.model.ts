import { Socket } from 'socket.io';

import { KnownHeader } from '../../../http/known-header.enum';
import { Version } from '../../../versioning/version.model';
import { SentWebsocketMessage } from '../sent-websocket-message.model';
import { LooseWebsocketEvent, WebsocketEvent } from '../websocket-event.enum';
import { WebsocketRequest } from '../websocket-request.model';
import { BaseWebsocketConnection } from './base-websocket-connection.model';

/**
 * A socket.io websocket connection.
 */
export class SocketIOWebsocketConnection implements BaseWebsocketConnection {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly id: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    get offset(): number | undefined {
        // anything but a number was refused at the handshake, so this is a client that sent none
        const offset: unknown = this.socket.handshake.auth['offset'];
        return typeof offset === 'number' ? offset : undefined;
    }
    set offset(value: number | undefined) {
        this.socket.handshake.auth['offset'] = value;
    }

    /**
     * The request the connection was opened with: the headers and the query of its handshake.
     */
    readonly handshakeRequest: WebsocketRequest;

    /**
     * Creates the connection of a socket.
     * @param socket - The socket.
     * @param userId - The id of the user its handshake logged in, if any.
     * @param resolvedVersion - The version its handshake resolved to.
     * @param handshakeRequest - The request the connection was opened with: the headers and the query of its
     * handshake, with the headers its client sent in the `auth` of the handshake. Without it, the headers and the
     * query of the handshake alone.
     */
    constructor(
        private readonly socket: Socket,
        public userId: string | undefined,
        readonly resolvedVersion: Version,
        handshakeRequest?: WebsocketRequest
    ) {
        this.id = this.socket.id;
        // optional until 4.0, for a connection created as in 3.2, which read the request off its socket
        this.handshakeRequest = handshakeRequest ?? {
            headers: socket.handshake.headers as Partial<Record<KnownHeader, string | undefined>>,
            body: undefined,
            query: socket.handshake.query,
            params: {}
        };
    }

    /**
     * Disconnects the socket.
     * @param close - Whether or not to close the underlying connection.
     */
    disconnect(close: boolean): void {
        this.socket.disconnect(close);
    }

    /**
     * Emits an event to the socket.
     * @param event - The event to emit.
     * @param data - The data to emit.
     */
    emit(event: LooseWebsocketEvent, data: SentWebsocketMessage): void {
        this.socket.emit(event, data);
    }

    /**
     * Emits an event to the socket and expects a return.
     * @param event - The event to emit.
     * @param data - The data to emit.
     * @param timeoutInMs - The timeout after which an error should be thrown.
     * @returns The response from the connection.
     */
    async emitWithAck<R>(event: LooseWebsocketEvent, data: SentWebsocketMessage, timeoutInMs: number): Promise<R> {
        return await this.socket.timeout(timeoutInMs).emitWithAck(event, data) as R;
    }

    /**
     * Joins the given channel or channels.
     * @param channels - The channel or channels to join.
     */
    async join(channels: string | string[]): Promise<void> {
        await this.socket.join(channels);
    }

    /**
     * Whether the connection is in the given room.
     * @param room - The room.
     * @returns True when the connection joined it and has not left it.
     */
    isIn(room: string): boolean {
        return this.socket.rooms.has(room);
    }

    /**
     * Leaves the given channel or channels.
     * @param channels - The channel or channels to join.
     */
    async leave(channels: string | string[]): Promise<void> {
        if (typeof channels === 'string') {
            await this.socket.leave(channels);
            return;
        }

        await Promise.all(channels.map(c => this.socket.leave(c)));
    }

    /**
     * Registers an on disconnect event listener.
     * @param listener - The listener to register.
     */
    onDisconnect(listener: () => void | Promise<void>): void {
        this.socket.on(WebsocketEvent.DISCONNECT, listener);
    }

    /**
     * Adds a listener that will be fired when any event is received. The event name is passed as the first argument to the callback.
     * @param listener - The listener to register.
     */
    onAny(listener: (ev: string, ...args: unknown[]) => void | Promise<void>): void {
        // eslint-disable-next-line typescript/no-misused-promises
        this.socket.onAny(listener);
    }
}