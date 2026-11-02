import { WebsocketMessageRefusal, WebsocketMessageSizeScanner } from './websocket-message-size.scanner';

/**
 * What separates the packets of one polling request (engine.io protocol 4).
 */
const RECORD_SEPARATOR: string = '\u001E';

/**
 * The engine.io packet type of a binary attachment sent over polling, as base64.
 */
const BINARY_RECORD_TYPE: string = 'b';

/**
 * Reads the packets a client sends over long polling as the request body arrives, and keeps every
 * one against what its event allows.
 *
 * A request body is the packets one after the other, separated by a record separator. Each is a
 * message of its own, and its bytes are counted as they come in.
 */
export class PollingPayloadScanner {
    private inRecord: boolean = false;
    private binary: boolean = false;
    private refusal: WebsocketMessageRefusal | undefined;

    constructor(private readonly sizes: WebsocketMessageSizeScanner) {}

    /**
     * Reads the next piece of the request body.
     * @param chunk - The piece, as text.
     * @returns The refusal once a packet is over the size its event allows. Nothing after it is read.
     */
    push(chunk: string): WebsocketMessageRefusal | undefined {
        let start: number = 0;
        while (this.refusal == undefined && start < chunk.length) {
            if (!this.inRecord) {
                this.binary = chunk[start] === BINARY_RECORD_TYPE;
                this.sizes.startMessage(this.binary);
                this.inRecord = true;
            }
            const end: number = chunk.indexOf(RECORD_SEPARATOR, start);
            const piece: string = end === -1 ? chunk.slice(start) : chunk.slice(start, end);
            this.refusal = this.sizes.addBytes(Buffer.byteLength(piece));
            if (this.refusal == undefined && !this.binary && this.sizes.needsPrefix) {
                this.refusal = this.sizes.feedPrefix(Buffer.from(piece, 'utf8'));
            }
            if (end === -1) {
                return this.refusal;
            }
            this.sizes.endMessage();
            this.inRecord = false;
            start = end + 1;
        }
        return this.refusal;
    }

    /**
     * Ends the request body, and with it the packet that has no separator after it.
     */
    end(): void {
        if (this.inRecord && this.refusal == undefined) {
            this.sizes.endMessage();
        }
        this.inRecord = false;
    }
}