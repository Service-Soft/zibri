import { SocketIoPacketPrefix, SocketIoPacketUtilities } from './socket-io-packet.utilities';

/**
 * Answers the most a message of an event may weigh, in bytes. Asked with undefined for a message
 * that carries no event, such as an acknowledgement.
 */
export type WebsocketMessageLimitResolver = (event: string | undefined) => number;

/**
 * A message that is over the size its event allows.
 */
export type WebsocketMessageRefusal = {
    /**
     * The event, or undefined for a message that carries none.
     */
    event: string | undefined,
    /**
     * How many bytes the message has, or declares, so far.
     */
    bytes: number,
    /**
     * The most it may have.
     */
    maxBytes: number
};

/**
 * How many bytes of a message are read to find its event. A packet whose event name is not within
 * them is bounded like a message without an event.
 */
const MAX_PREFIX_BYTES: number = 1024;

/**
 * Keeps the bytes of the messages of one connection against what their events allow.
 *
 * The transports differ in how a message arrives, so this knows nothing of frames or requests: it
 * is told when a message starts, given its first bytes until the event is known, told how many bytes
 * it has or declares, and told when it ends. The binary attachments of a binary event are messages
 * of their own, and are counted against the budget the event's own message left.
 */
export class WebsocketMessageSizeScanner {
    private prefix: Buffer[] = [];
    private prefixBytes: number = 0;
    private event: string | undefined;
    /**
     * What the message's event allows, which a refusal names.
     */
    private maxBytes: number | undefined;
    /**
     * What the message may weigh: what its event allows, less what the messages before it took of
     * that when it is an attachment.
     */
    private allowance: number | undefined;
    private bytes: number = 0;
    private binary: boolean = false;
    private announcedAttachments: number = 0;
    private pendingAttachments: number = 0;
    private attachmentEvent: string | undefined;
    private attachmentMaxBytes: number = 0;
    private attachmentBudget: number = 0;

    constructor(private readonly resolveMaxBytes: WebsocketMessageLimitResolver) {}

    /**
     * Whether the message's first bytes are still needed to know its limit.
     * @returns True until the limit of the message is known.
     */
    get needsPrefix(): boolean {
        return this.allowance == undefined;
    }

    /**
     * Begins a message.
     * @param binary - Whether it is binary: an attachment of the binary event before it, or a message that carries no event.
     */
    startMessage(binary: boolean): void {
        this.prefix = [];
        this.prefixBytes = 0;
        this.bytes = 0;
        this.binary = binary;
        this.announcedAttachments = 0;
        if (!binary) {
            this.event = undefined;
            this.maxBytes = undefined;
            this.allowance = undefined;
            return;
        }
        if (this.pendingAttachments > 0) {
            this.event = this.attachmentEvent;
            this.maxBytes = this.attachmentMaxBytes;
            this.allowance = this.attachmentBudget;
            return;
        }
        this.bound(undefined);
    }

    /**
     * Begins a message whose bytes cannot be read, such as a compressed one. It is bounded like a
     * message without an event.
     */
    startOpaqueMessage(): void {
        this.startMessage(false);
        this.bound(undefined);
    }

    /**
     * Hands over the next of the message's first bytes, until its event is known.
     * @param bytes - The bytes, in the order they arrived.
     * @returns The refusal, once the bytes counted so far are over the limit the event allows.
     */
    feedPrefix(bytes: Buffer): WebsocketMessageRefusal | undefined {
        if (this.allowance != undefined) {
            return undefined;
        }
        this.prefix.push(bytes);
        this.prefixBytes += bytes.length;
        // the first kilobyte alone, however much arrived at once
        const parsed: SocketIoPacketPrefix = SocketIoPacketUtilities.resolvePrefix(
            Buffer.concat(this.prefix).subarray(0, MAX_PREFIX_BYTES)
                .toString('utf8')
        );
        if (parsed.complete) {
            this.bound(parsed.event);
            this.announcedAttachments = parsed.attachments;
        }
        else if (this.prefixBytes >= MAX_PREFIX_BYTES) {
            this.bound(undefined);
        }
        return this.resolveRefusal();
    }

    /**
     * Counts bytes of the message, whether they arrived or were only declared.
     * @param count - How many.
     * @returns The refusal, once the message is over the limit its event allows.
     */
    addBytes(count: number): WebsocketMessageRefusal | undefined {
        this.bytes += count;
        return this.resolveRefusal();
    }

    /**
     * Ends the message, which decides what the attachments it announced may weigh together.
     */
    endMessage(): void {
        if (this.binary) {
            if (this.pendingAttachments > 0) {
                this.pendingAttachments--;
                this.attachmentBudget -= this.bytes;
            }
            return;
        }
        if (this.announcedAttachments > 0 && this.maxBytes != undefined) {
            this.pendingAttachments = this.announcedAttachments;
            this.attachmentEvent = this.event;
            this.attachmentMaxBytes = this.maxBytes;
            this.attachmentBudget = this.maxBytes - this.bytes;
        }
    }

    /**
     * Bounds the message by what its event allows.
     * @param event - The event, or undefined for a message that carries none.
     */
    private bound(event: string | undefined): void {
        this.event = event;
        this.maxBytes = this.resolveMaxBytes(event);
        this.allowance = this.maxBytes;
    }

    private resolveRefusal(): WebsocketMessageRefusal | undefined {
        return this.allowance == undefined || this.maxBytes == undefined || this.bytes <= this.allowance
            ? undefined
            : { event: this.event, bytes: this.bytes, maxBytes: this.maxBytes };
    }
}