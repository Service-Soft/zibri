import { Socket } from 'socket.io';

import { BaseWebsocketConnection } from './base-websocket-connection.model.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { Version } from '../../../versioning/version.model.ts';
import { LooseWebsocketEvent, WebsocketEvent } from '../websocket-event.enum.ts';
import { WebsocketMessage } from '../websocket-message.model.ts';
import { WebsocketRequest } from '../websocket-request.model.ts';

/**
 * A socket.io websocket connection.
 */
export class SocketIOWebsocketConnection implements BaseWebsocketConnection {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly id: string;
    /**
     * Whether the connection state was recovered after a temporary disconnection.
     * In that case, any missed packets will be transmitted to the client, the data attribute and the rooms will be restored.
     */
    readonly recovered: boolean;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    get offset(): number | undefined {
        // anything but a number was refused at the handshake, so this is a client that sent none
        const offset: unknown = this.socket.handshake.auth['offset'];
        return typeof offset === 'number' ? offset : undefined;
    }
    set offset(value: number | undefined) {
        this.socket.handshake.auth['offset'] = value;
    }

    /**
     * The request the connection was opened with.
     * @returns The headers and the query of its handshake.
     */
    get handshakeRequest(): WebsocketRequest {
        return {
            headers: this.socket.handshake.headers as Partial<Record<KnownHeader, string | undefined>>,
            body: undefined,
            query: this.socket.handshake.query as Partial<Record<string, string | undefined>>,
            params: {}
        };
    }

    constructor(
        private readonly socket: Socket,
        public userId: string | undefined,
        readonly resolvedVersion: Version

    ) {
        this.id = this.socket.id;
        this.recovered = this.socket.recovered;
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
    emit(event: LooseWebsocketEvent, data: WebsocketMessage): void {
        this.socket.emit(event, data);
    }

    /**
     * Emits an event to the socket and expects a return.
     * @param event - The event to emit.
     * @param data - The data to emit.
     * @param timeout - The timeout after which an error should be thrown.
     * @returns The response from the connection.
     */
    async emitWithAck<R>(event: LooseWebsocketEvent, data: WebsocketMessage, timeout: number): Promise<R> {
        return await this.socket.timeout(timeout).emitWithAck(event, data) as R;
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

        await Promise.all(channels.map(async c => await this.socket.leave(c)));
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