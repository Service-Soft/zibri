import { IncomingMessage } from 'node:http';
import { Duplex } from 'node:stream';

import type { Server as WebSocketServer, ServerOptions as WebSocketServerOptions, WebSocket } from 'ws';

import { WebsocketFrameScanner } from './websocket-frame.scanner';
import { WebsocketMessageLimitResolver, WebsocketMessageRefusal, WebsocketMessageSizeScanner } from './websocket-message-size.scanner';

/**
 * The close code for a message larger than the server accepts (RFC 6455, section 7.4.1), the one
 * the websocket server closes with for a message over `maxMessageSize`.
 */
const MESSAGE_TOO_BIG_CLOSE_CODE: number = 1009;

/**
 * The most a close reason may weigh: a control frame's payload minus the two bytes of the code.
 */
const MAX_CLOSE_REASON_BYTES: number = 123;

/**
 * The opcode of a close frame with its FIN bit, as the first byte of the frame.
 */
const CLOSE_FRAME_FIRST_BYTE: number = 0x88;

/**
 * Told of every message a connection was closed for.
 */
export type WebsocketMessageRefusalListener = (refusal: WebsocketMessageRefusal) => void;

/**
 * A websocket server class as the socket.io server takes one.
 */
export type WebSocketServerClass = new (options?: WebSocketServerOptions) => WebSocketServer;

/**
 * The socket a connection is given, with its frames measured on the way in.
 *
 * ws reads the connection through this rather than through the socket itself, so what the scanner
 * refuses never reaches it: a message that is over its size is not parsed, let alone handled, and the
 * connection is closed underneath ws with the frame it closes with itself for a message over the
 * server's limit. What ws writes goes to the socket as it is.
 */
class MeasuredSocket extends Duplex {
    private refused: boolean = false;

    constructor(
        private readonly socket: Duplex,
        private readonly scanner: WebsocketFrameScanner,
        private readonly onRefused: WebsocketMessageRefusalListener
    ) {
        super();
        socket.on('data', (chunk: Buffer) => this.onData(chunk));
        // eslint-disable-next-line unicorn/no-null
        socket.on('end', () => this.push(null));
        socket.on('close', () => this.destroy());
        socket.on('error', (error: Error) => this.destroy(error));
    }

    /**
     * Measures bytes that arrived before the connection was handed over, which ws is given through `unshift`.
     * @param head - The bytes.
     */
    measure(head: Buffer): void {
        if (head.length > 0) {
            this.refuseIfOver(this.scanner.push(head));
        }
    }

    /**
     * How long the socket may stay silent. ws sets it to never.
     * @param timeoutInMs - The time.
     */
    setTimeout(timeoutInMs: number): void {
        if ('setTimeout' in this.socket && typeof this.socket.setTimeout === 'function') {
            this.socket.setTimeout(timeoutInMs);
        }
    }

    /**
     * Sends every frame as soon as it is written, as ws asks a socket to.
     */
    setNoDelay(): void {
        if ('setNoDelay' in this.socket && typeof this.socket.setNoDelay === 'function') {
            this.socket.setNoDelay();
        }
    }

    override _read(): void {
        this.socket.resume();
    }

    override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.socket.write(chunk, encoding, callback);
    }

    override _final(callback: (error?: Error | null) => void): void {
        this.socket.end(callback);
    }

    override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
        this.socket.destroy();
        callback(error);
    }

    private onData(chunk: Buffer): void {
        if (this.refused) {
            return;
        }
        if (this.refuseIfOver(this.scanner.push(chunk))) {
            return;
        }
        if (!this.push(chunk)) {
            this.socket.pause();
        }
    }

    private refuseIfOver(refusal: WebsocketMessageRefusal | undefined): boolean {
        if (refusal == undefined) {
            return false;
        }
        this.refused = true;
        this.onRefused(refusal);
        this.socket.write(closeFrame(refusal), () => this.socket.destroy());
        return true;
    }
}

/**
 * Builds the websocket server class the socket.io server is given: ws's own, measuring every
 * connection's frames before ws reads them.
 *
 * Built from the loaded package rather than declared as a class, because ws is an optional peer that
 * an application without websockets never installs.
 * @param ws - The ws package.
 * @param resolveMaxBytes - What a message of each event may weigh.
 * @param onRefused - Told of every connection closed for a message over its size.
 * @returns The server class.
 */
export function messageSizeLimitingWebSocketServerClass(
    ws: typeof import('ws'),
    resolveMaxBytes: WebsocketMessageLimitResolver,
    onRefused: WebsocketMessageRefusalListener
): WebSocketServerClass {
    return class MessageSizeLimitingWebSocketServer extends ws.WebSocketServer {
        override handleUpgrade(
            request: IncomingMessage,
            socket: Duplex,
            upgradeHead: Buffer,
            callback: (client: WebSocket, request: IncomingMessage) => void
        ): void {
            const measured: MeasuredSocket = new MeasuredSocket(
                socket,
                new WebsocketFrameScanner(new WebsocketMessageSizeScanner(resolveMaxBytes)),
                onRefused
            );
            measured.measure(upgradeHead);
            super.handleUpgrade(request, measured, upgradeHead, callback);
        }
    };
}

/**
 * The frame a connection is closed with.
 * @param refusal - The message it is closed for.
 * @returns The frame.
 */
function closeFrame(refusal: WebsocketMessageRefusal): Buffer {
    const reason: Buffer = Buffer.from(
        `A message of ${refusal.bytes} bytes for "${refusal.event ?? ''}", at most ${refusal.maxBytes} are accepted`,
        'utf8'
    ).subarray(0, MAX_CLOSE_REASON_BYTES);
    const frame: Buffer = Buffer.alloc(4 + reason.length);
    frame[0] = CLOSE_FRAME_FIRST_BYTE;
    frame[1] = 2 + reason.length;
    frame.writeUInt16BE(MESSAGE_TOO_BIG_CLOSE_CODE, 2);
    reason.copy(frame, 4);
    return frame;
}
