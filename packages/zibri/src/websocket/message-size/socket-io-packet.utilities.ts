/**
 * What the first bytes of an engine.io packet say about the socket.io packet inside it.
 */
export type SocketIoPacketPrefix = {
    /**
     * Whether enough of the packet has arrived to know its event.
     */
    complete: false
} | {
    /**
     * Whether enough of the packet has arrived to know its event.
     */
    complete: true,
    /**
     * The event the packet carries, or undefined for a packet that carries none, such as a ping or an
     * acknowledgement.
     */
    event: string | undefined,
    /**
     * How many binary attachments follow the packet, each as a message of its own.
     */
    attachments: number
};

/**
 * The socket.io packet types that carry an event.
 */
const EVENT_TYPES: Set<string> = new Set(['2', '5']);

/**
 * The socket.io packet types that are followed by binary attachments.
 */
const BINARY_TYPES: Set<string> = new Set(['5', '6']);

/**
 * The engine.io packet type of a message, the one kind of packet that holds a socket.io packet.
 */
const ENGINE_MESSAGE_TYPE: string = '4';

/**
 * Reads the socket.io packet at the start of an engine.io packet, as far as the event it carries.
 *
 * A packet is `<engine type><socket.io type>[<attachments>-][/<namespace>,][<ack id>]<json>`, and the
 * json of an event is an array whose first item is the event name. Nothing past that name is read.
 */
export abstract class SocketIoPacketUtilities {

    /**
     * Reads which event a packet carries, from as much of it as has arrived.
     * @param prefix - The first bytes of an engine.io packet, as text.
     * @returns The event and the attachments that follow, or that the prefix ends before the event name does.
     */
    static resolvePrefix(prefix: string): SocketIoPacketPrefix {
        if (prefix.length === 0) {
            return { complete: false };
        }
        if (prefix[0] !== ENGINE_MESSAGE_TYPE) {
            return { complete: true, event: undefined, attachments: 0 };
        }
        if (prefix.length < 2) {
            return { complete: false };
        }
        const type: string = prefix[1] ?? '';
        let index: number = 2;
        let attachments: number = 0;

        if (BINARY_TYPES.has(type)) {
            const dash: number = prefix.indexOf('-', index);
            if (dash === -1) {
                return { complete: false };
            }
            attachments = Number(prefix.slice(index, dash));
            index = dash + 1;
        }
        if (prefix[index] === '/') {
            const comma: number = prefix.indexOf(',', index);
            if (comma === -1) {
                return { complete: false };
            }
            index = comma + 1;
        }
        for (let char: string | undefined = prefix[index]; char != undefined && char >= '0' && char <= '9'; char = prefix[index]) {
            index++;
        }
        if (!EVENT_TYPES.has(type)) {
            return { complete: true, event: undefined, attachments };
        }
        return this.resolveEventName(prefix, index, attachments);
    }

    /**
     * Reads the event name at the start of an event's json.
     * @param prefix - The packet so far.
     * @param index - Where its json starts.
     * @param attachments - How many attachments follow the packet.
     * @returns The name, or that the prefix ends before it does.
     */
    private static resolveEventName(prefix: string, index: number, attachments: number): SocketIoPacketPrefix {
        if (index + 1 >= prefix.length) {
            return { complete: false };
        }
        // not an array of a string: socket.io refuses the packet, so there is no event to bound
        if (prefix[index] !== '[' || prefix[index + 1] !== '"') {
            return { complete: true, event: undefined, attachments };
        }
        let end: number = index + 2;
        while (end < prefix.length) {
            if (prefix[end] === '\\') {
                end += 2;
                continue;
            }
            if (prefix[end] === '"') {
                break;
            }
            end++;
        }
        if (end >= prefix.length) {
            return { complete: false };
        }
        try {
            const event: unknown = JSON.parse(prefix.slice(index + 1, end + 1));
            return { complete: true, event: typeof event === 'string' ? event : undefined, attachments };
        }
        catch {
            return { complete: true, event: undefined, attachments };
        }
    }
}
