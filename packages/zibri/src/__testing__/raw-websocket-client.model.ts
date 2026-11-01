import { randomBytes } from 'node:crypto';
import { connect, Socket } from 'node:net';

/**
 * What a websocket connection was closed with.
 */
export type RawWebsocketClose = {
    /**
     * The close code of the close frame the server sent, or undefined when the connection ended without one.
     */
    code: number | undefined,
    /**
     * The reason of that frame.
     */
    reason: string
};

/**
 * A frame to send, or the header of one.
 */
export type RawWebsocketFrame = {
    /**
     * The opcode: 1 for text, 2 for binary, 0 for a continuation.
     */
    opcode: number,
    /**
     * Whether the frame is the last of its message.
     */
    fin: boolean,
    /**
     * The payload.
     */
    payload: Buffer
};

/**
 * The opcode of a text frame.
 */
const TEXT_OPCODE: number = 0x1;

/**
 * The opcode of a close frame.
 */
const CLOSE_OPCODE: number = 0x8;

/**
 * The opcode of a pong frame.
 */
const PONG_OPCODE: number = 0xA;

/**
 * The engine.io packets of a ping and a pong, which the server sends and expects to keep the connection.
 */
const ENGINE_PING: string = '2';
const ENGINE_PONG: string = '3';

/**
 * A websocket client that writes its own frames, for a test that sends what no client library does:
 * a frame whose payload never arrives in full, a message in many fragments, a mask of its choosing.
 *
 * It speaks enough of socket.io to be connected: the engine.io handshake and the connect packet of
 * the default namespace. The payload of a frame written through `writeFrameHeader` is sent as is,
 * under a mask of zeros, so the bytes on the wire are the bytes given.
 */
export class RawWebsocketClient {
    private received: Buffer = Buffer.alloc(0);
    private readonly messages: string[] = [];
    private readonly waiting: ((message: string) => void)[] = [];
    private close: RawWebsocketClose | undefined;
    private readonly closeWaiting: ((close: RawWebsocketClose) => void)[] = [];

    private constructor(private readonly socket: Socket) {
        socket.on('data', (chunk: Buffer) => this.onData(chunk));
        socket.on('close', () => this.onClose({ code: undefined, reason: '' }));
        socket.on('error', () => {});
    }

    /**
     * How many bytes were handed to the operating system to send.
     */
    get bytesWritten(): number {
        return this.socket.bytesWritten;
    }

    /**
     * Whether the connection is still open on this side.
     */
    get isOpen(): boolean {
        return !this.socket.destroyed && this.close == undefined;
    }

    /**
     * Opens a connection and connects to the default namespace of the socket.io server.
     * @param baseUrl - Where the application listens.
     * @param path - Where the websocket server listens.
     * @returns The connected client.
     * @throws When the server does not accept the upgrade.
     */
    static async connect(baseUrl: string, path: string): Promise<RawWebsocketClient> {
        const url: URL = new URL(baseUrl);
        const socket: Socket = connect(Number(url.port), url.hostname);
        await new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('error', reject);
        });
        const response: string = await new Promise<string>((resolve, reject) => {
            let head: string = '';
            // eslint-disable-next-line typescript/typedef
            const onData = (chunk: Buffer): void => {
                head += chunk.toString('latin1');
                const end: number = head.indexOf('\r\n\r\n');
                if (end === -1) {
                    return;
                }
                socket.off('data', onData);
                // what came after the headers are the first frames, kept for the client's own
                // listener: a flowing socket emits what is unshifted at once, to whoever listens
                socket.pause();
                socket.unshift(Buffer.from(head.slice(end + 4), 'latin1'));
                resolve(head.slice(0, end));
            };
            socket.on('data', onData);
            socket.once('error', reject);
            socket.write([
                `GET ${path}/?EIO=4&transport=websocket HTTP/1.1`,
                `Host: ${url.host}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
                'Sec-WebSocket-Version: 13',
                '',
                ''
            ].join('\r\n'));
        });
        if (!response.startsWith('HTTP/1.1 101')) {
            socket.destroy();
            throw new Error(`The server refused the websocket upgrade: ${response.split('\r\n')[0]}`);
        }
        const client: RawWebsocketClient = new RawWebsocketClient(socket);
        socket.resume();
        // the engine.io open packet, then socket.io's connect and its answer
        await client.nextMessage();
        client.sendText('40');
        await client.nextMessage();
        return client;
    }

    /**
     * Sends a text message in one frame.
     * @param text - The message.
     */
    sendText(text: string): void {
        this.sendFrame({ opcode: TEXT_OPCODE, fin: true, payload: Buffer.from(text, 'utf8') });
    }

    /**
     * Sends one frame, under a random mask.
     * @param frame - The frame.
     */
    sendFrame(frame: RawWebsocketFrame): void {
        const mask: Buffer = randomBytes(4);
        const masked: Buffer = Buffer.from(frame.payload);
        for (let i: number = 0; i < masked.length; i++) {
            masked[i] = (masked[i] ?? 0) ^ (mask[i % 4] ?? 0);
        }
        this.socket.write(Buffer.concat([this.frameHeader(frame.opcode, frame.fin, frame.payload.length, mask), masked]));
    }

    /**
     * Writes the header of a frame whose payload follows through `write`, under a mask of zeros.
     * @param opcode - The opcode.
     * @param fin - Whether the frame is the last of its message.
     * @param length - The length the header declares, which the writes after it need not reach.
     */
    writeFrameHeader(opcode: number, fin: boolean, length: number): void {
        this.socket.write(this.frameHeader(opcode, fin, length, Buffer.alloc(4)));
    }

    /**
     * Writes bytes as they are, and waits for the operating system to take them.
     * @param bytes - The bytes.
     * @returns Whether they were taken, which they are not once the server closed the connection.
     */
    async write(bytes: Buffer): Promise<boolean> {
        if (!this.isOpen) {
            return false;
        }
        return await new Promise<boolean>(resolve => {
            this.socket.write(bytes, error => resolve(error == undefined));
        });
    }

    /**
     * The next text message from the server, pings left out.
     * @returns The message.
     */
    async nextMessage(): Promise<string> {
        const message: string | undefined = this.messages.shift();
        if (message != undefined) {
            return message;
        }
        return await new Promise<string>(resolve => this.waiting.push(resolve));
    }

    /**
     * Waits for the server to close the connection.
     * @param timeoutInMs - How long to wait at most.
     * @returns What it was closed with.
     * @throws When it stays open.
     */
    async waitForClose(timeoutInMs: number): Promise<RawWebsocketClose> {
        if (this.close != undefined) {
            return this.close;
        }
        return await new Promise<RawWebsocketClose>((resolve, reject) => {
            const timer: NodeJS.Timeout = setTimeout(() => reject(new Error(`The connection stayed open for ${timeoutInMs} ms.`)), timeoutInMs);
            this.closeWaiting.push(close => {
                clearTimeout(timer);
                resolve(close);
            });
        });
    }

    /**
     * Ends the connection.
     */
    destroy(): void {
        this.socket.destroy();
    }

    private frameHeader(opcode: number, fin: boolean, length: number, mask: Buffer): Buffer {
        const first: number = (fin ? 0x80 : 0) | opcode;
        let header: Buffer;
        if (length < 126) {
            header = Buffer.from([first, 0x80 | length]);
        }
        else if (length < 65_536) {
            header = Buffer.alloc(4);
            header[0] = first;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(length, 2);
        }
        else {
            header = Buffer.alloc(10);
            header[0] = first;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(length), 2);
        }
        return Buffer.concat([header, mask]);
    }

    private onData(chunk: Buffer): void {
        this.received = Buffer.concat([this.received, chunk]);
        for (;;) {
            if (this.received.length < 2) {
                return;
            }
            const first: number = this.received[0] ?? 0;
            const second: number = this.received[1] ?? 0;
            const opcode: number = first & 0x0F;
            let length: number = second & 0x7F;
            let offset: number = 2;
            if (length === 126) {
                if (this.received.length < 4) {
                    return;
                }
                length = this.received.readUInt16BE(2);
                offset = 4;
            }
            else if (length === 127) {
                if (this.received.length < 10) {
                    return;
                }
                length = Number(this.received.readBigUInt64BE(2));
                offset = 10;
            }
            if (this.received.length < offset + length) {
                return;
            }
            const payload: Buffer = this.received.subarray(offset, offset + length);
            this.received = this.received.subarray(offset + length);
            this.onFrame(opcode, payload);
        }
    }

    private onFrame(opcode: number, payload: Buffer): void {
        if (opcode === CLOSE_OPCODE) {
            this.onClose({
                code: payload.length >= 2 ? payload.readUInt16BE(0) : undefined,
                reason: payload.subarray(2).toString('utf8')
            });
            return;
        }
        if (opcode === TEXT_OPCODE) {
            const text: string = payload.toString('utf8');
            if (text === ENGINE_PING) {
                this.sendText(ENGINE_PONG);
                return;
            }
            const waiting: ((message: string) => void) | undefined = this.waiting.shift();
            if (waiting == undefined) {
                this.messages.push(text);
            }
            else {
                waiting(text);
            }
        }
        else if (opcode === PONG_OPCODE) {
            return;
        }
    }

    private onClose(close: RawWebsocketClose): void {
        if (this.close != undefined) {
            return;
        }
        this.close = close;
        for (const waiting of this.closeWaiting.splice(0)) {
            waiting(close);
        }
    }
}
