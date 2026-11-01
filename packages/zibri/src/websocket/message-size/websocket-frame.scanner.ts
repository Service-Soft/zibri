import { WebsocketMessageRefusal, WebsocketMessageSizeScanner } from './websocket-message-size.scanner';

/**
 * The opcode of a frame that continues the message before it (RFC 6455, section 5.2).
 */
const CONTINUATION_OPCODE: number = 0x0;

/**
 * The opcode of a frame that starts a binary message.
 */
const BINARY_OPCODE: number = 0x2;

/**
 * The lowest opcode of a control frame. Everything below it carries data.
 */
const FIRST_CONTROL_OPCODE: number = 0x8;

/**
 * The longest a frame header can be: two bytes, an eight byte length and a four byte mask.
 */
const MAX_HEADER_BYTES: number = 14;

/**
 * Reads the frames of a websocket connection as their bytes arrive, and keeps every message against
 * what its event allows.
 *
 * Only the header of a frame is parsed, and of a message's first frame as many payload bytes as it
 * takes to find its event. Everything else is counted by the length the header declares, so a
 * message that is too large is known before its payload is read.
 */
export class WebsocketFrameScanner {
    private readonly header: Buffer = Buffer.alloc(MAX_HEADER_BYTES);
    private headerBytes: number = 0;
    private headerLength: number = 2;
    private inPayload: boolean = false;
    private payloadRemaining: number = 0;
    private payloadOffset: number = 0;
    private mask: number[] = [0, 0, 0, 0];
    private dataFrame: boolean = false;
    private fin: boolean = true;
    private refusal: WebsocketMessageRefusal | undefined;

    constructor(private readonly sizes: WebsocketMessageSizeScanner) {}

    /**
     * Reads the frames in the next bytes of the connection.
     * @param chunk - The bytes, as they arrived.
     * @returns The refusal once a message is over the size its event allows. Nothing after it is read.
     */
    push(chunk: Buffer): WebsocketMessageRefusal | undefined {
        let offset: number = 0;
        while (this.refusal == undefined && offset < chunk.length) {
            offset = this.inPayload ? this.readPayload(chunk, offset) : this.readHeader(chunk, offset);
        }
        return this.refusal;
    }

    private readHeader(chunk: Buffer, offset: number): number {
        const take: number = Math.min(this.headerLength - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + take);
        this.headerBytes += take;
        if (this.headerBytes === 2) {
            const second: number = this.header[1] ?? 0;
            const masked: boolean = (second & 0x80) !== 0;
            const length7: number = second & 0x7F;
            this.headerLength = 2 + (length7 === 126 ? 2 : length7 === 127 ? 8 : 0) + (masked ? 4 : 0);
        }
        if (this.headerBytes === this.headerLength) {
            this.beginFrame();
        }
        return offset + take;
    }

    private beginFrame(): void {
        const first: number = this.header[0] ?? 0;
        const second: number = this.header[1] ?? 0;
        const opcode: number = first & 0x0F;
        const compressed: boolean = (first & 0x40) !== 0;
        const length7: number = second & 0x7F;
        let length: number = length7;
        let index: number = 2;
        if (length7 === 126) {
            length = this.header.readUInt16BE(2);
            index = 4;
        }
        else if (length7 === 127) {
            length = Number(this.header.readBigUInt64BE(2));
            index = 10;
        }
        this.mask = (second & 0x80) === 0 ? [0, 0, 0, 0] : [...this.header.subarray(index, index + 4)];

        this.fin = (first & 0x80) !== 0;
        this.dataFrame = opcode < FIRST_CONTROL_OPCODE;
        this.payloadRemaining = length;
        this.payloadOffset = 0;
        this.headerBytes = 0;
        this.headerLength = 2;
        this.inPayload = true;

        if (this.dataFrame) {
            if (opcode !== CONTINUATION_OPCODE) {
                if (compressed) {
                    this.sizes.startOpaqueMessage();
                }
                else {
                    this.sizes.startMessage(opcode === BINARY_OPCODE);
                }
            }
            this.refusal = this.sizes.addBytes(length);
        }
        if (length === 0) {
            this.endFrame();
        }
    }

    private readPayload(chunk: Buffer, offset: number): number {
        const take: number = Math.min(this.payloadRemaining, chunk.length - offset);
        if (this.dataFrame && this.sizes.needsPrefix) {
            const unmasked: Buffer = Buffer.allocUnsafe(take);
            for (let i: number = 0; i < take; i++) {
                unmasked[i] = (chunk[offset + i] ?? 0) ^ (this.mask[(this.payloadOffset + i) % 4] ?? 0);
            }
            this.refusal = this.sizes.feedPrefix(unmasked);
        }
        this.payloadOffset += take;
        this.payloadRemaining -= take;
        if (this.payloadRemaining === 0) {
            this.endFrame();
        }
        return offset + take;
    }

    private endFrame(): void {
        this.inPayload = false;
        if (this.dataFrame && this.fin) {
            this.sizes.endMessage();
        }
    }
}
