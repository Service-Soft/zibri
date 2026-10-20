import { CborValue } from './cbor-value.type.ts';

/**
 * The major types of CBOR (RFC 8949 §3.1) a fake device writes.
 */
enum MajorType {
    UNSIGNED = 0,
    NEGATIVE = 1,
    BYTES = 2,
    TEXT = 3,
    ARRAY = 4,
    MAP = 5
}

/**
 * Encodes CBOR, the binary format a device answers in when it creates or uses a passkey.
 *
 * Only what WebAuthn needs: no floats, tags or indefinite lengths. Map keys keep the order they were
 * set in, which is the order WebAuthn's examples use.
 */
export class CborUtilities {
    /**
     * Encodes a value.
     * @param value - The value.
     * @returns Its CBOR encoding.
     */
    static encode(value: CborValue): Buffer {
        if (typeof value === 'number') {
            return value < 0
                ? CborUtilities.encodeHead(MajorType.NEGATIVE, -1 - value)
                : CborUtilities.encodeHead(MajorType.UNSIGNED, value);
        }
        if (typeof value === 'string') {
            const text: Buffer = Buffer.from(value, 'utf8');
            return Buffer.concat([CborUtilities.encodeHead(MajorType.TEXT, text.length), text]);
        }
        if (value instanceof Uint8Array) {
            return Buffer.concat([CborUtilities.encodeHead(MajorType.BYTES, value.length), value]);
        }
        if (Array.isArray(value)) {
            return Buffer.concat([CborUtilities.encodeHead(MajorType.ARRAY, value.length), ...value.map(v => CborUtilities.encode(v))]);
        }
        const entries: Buffer[] = [...value.entries()].flatMap(([key, v]) => [CborUtilities.encode(key), CborUtilities.encode(v)]);
        return Buffer.concat([CborUtilities.encodeHead(MajorType.MAP, value.size), ...entries]);
    }

    /**
     * Encodes the head of an item: its major type and its argument, in as few bytes as fit.
     * @param type - The major type.
     * @param argument - The value, or the length, the head carries.
     * @returns The head.
     */
    private static encodeHead(type: MajorType, argument: number): Buffer {
        const prefix: number = type << 5;
        if (argument < 24) {
            return Buffer.from([prefix | argument]);
        }
        if (argument < 0x100) {
            return Buffer.from([prefix | 24, argument]);
        }
        if (argument < 0x1_00_00) {
            const head: Buffer = Buffer.alloc(3);
            head[0] = prefix | 25;
            head.writeUInt16BE(argument, 1);
            return head;
        }
        const head: Buffer = Buffer.alloc(5);
        head[0] = prefix | 26;
        head.writeUInt32BE(argument, 1);
        return head;
    }
}