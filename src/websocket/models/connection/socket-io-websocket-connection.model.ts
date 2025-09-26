import { Socket } from 'socket.io';

import { BaseWebsocketConnection } from './base-websocket-connection.model';
import { LooseWebsocketEvent, WebsocketEvent } from '../websocket-event.enum';
import { WebsocketMessage } from '../websocket-message.model';

/**
 * A socket.io websocket connection.
 */
export class SocketIOWebsocketConnection implements BaseWebsocketConnection {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly id: string;
    /**
     * Whether the connection state was recovered after a temporary disconnection.
     * In that case, any missed packets will be transmitted to the client, the data attribute and the rooms will be restored.
     */
    readonly recovered: boolean;
    // eslint-disable-next-line jsdoc/require-jsdoc
    get offset(): number {
        if (typeof this.socket.handshake.auth.offset !== 'number') {
            throw new Error('socket.io: auth.offset is not a number');
        }
        return this.socket.handshake.auth.offset;
    }
    set offset(value: number) {
        this.socket.handshake.auth.offset = value;
    }

    constructor(private readonly socket: Socket, public userId: string | undefined) {
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