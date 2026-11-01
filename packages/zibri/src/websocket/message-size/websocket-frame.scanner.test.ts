import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { WebsocketFrameScanner } from './websocket-frame.scanner';
import { WebsocketMessageLimitResolver, WebsocketMessageRefusal, WebsocketMessageSizeScanner } from './websocket-message-size.scanner';

/**
 * What a message of each event may weigh here: `small` a hundred bytes, anything else ten thousand.
 */
const SMALL_LIMIT: number = 100;
const OTHER_LIMIT: number = 10_000;
const resolveLimit: WebsocketMessageLimitResolver = event => event === 'small' ? SMALL_LIMIT : OTHER_LIMIT;

/**
 * A frame as a client sends one.
 */
type FrameInput = {
    opcode: number,
    fin?: boolean,
    compressed?: boolean,
    payload: Buffer,
    /**
     * The length the header declares, when it is not the payload's.
     */
    declaredLength?: number
};

/**
 * Builds a frame under a random mask.
 * @param input - The frame.
 * @returns Its bytes.
 */
function frame(input: FrameInput): Buffer {
    const length: number = input.declaredLength ?? input.payload.length;
    const first: number = ((input.fin ?? true) ? 0x80 : 0) | (input.compressed === true ? 0x40 : 0) | input.opcode;
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
    const mask: Buffer = randomBytes(4);
    const masked: Buffer = Buffer.from(input.payload);
    for (let i: number = 0; i < masked.length; i++) {
        masked[i] = (masked[i] ?? 0) ^ (mask[i % 4] ?? 0);
    }
    return Buffer.concat([header, mask, masked]);
}

/**
 * The engine.io packet of an event whose body is a text of the given length.
 * @param event - The event.
 * @param length - How long the text is.
 * @returns The packet.
 */
function packet(event: string, length: number): Buffer {
    return Buffer.from(`42["${event}",{"body":"${'x'.repeat(length)}"}]`, 'utf8');
}

/**
 * Pushes bytes through a fresh scanner, in pieces.
 * @param pieces - The pieces.
 * @returns The refusal, if any piece caused one, and after how many bytes.
 */
function scan(pieces: Buffer[]): { refusal: WebsocketMessageRefusal | undefined, afterBytes: number } {
    const scanner: WebsocketFrameScanner = new WebsocketFrameScanner(new WebsocketMessageSizeScanner(resolveLimit));
    let afterBytes: number = 0;
    for (const piece of pieces) {
        afterBytes += piece.length;
        const refusal: WebsocketMessageRefusal | undefined = scanner.push(piece);
        if (refusal != undefined) {
            return { refusal, afterBytes };
        }
    }
    return { refusal: undefined, afterBytes };
}

/**
 * Splits bytes into pieces of the given size.
 * @param bytes - The bytes.
 * @param size - The size of a piece.
 * @returns The pieces.
 */
function pieces(bytes: Buffer, size: number): Buffer[] {
    const result: Buffer[] = [];
    for (let i: number = 0; i < bytes.length; i += size) {
        result.push(bytes.subarray(i, i + size));
    }
    return result;
}

describe('WebsocketFrameScanner', () => {

    it('takes a message within what its event allows, however the bytes are cut', () => {
        const bytes: Buffer = frame({ opcode: 1, payload: packet('small', 50) });

        for (let at: number = 1; at < bytes.length; at++) {
            expect(scan([bytes.subarray(0, at), bytes.subarray(at)]).refusal).toBeUndefined();
        }
        expect(scan(pieces(bytes, 1)).refusal).toBeUndefined();
    });

    it('refuses a message over what its event allows, however the bytes are cut', () => {
        const bytes: Buffer = frame({ opcode: 1, payload: packet('small', 200) });

        for (let at: number = 1; at < bytes.length; at++) {
            expect(scan([bytes.subarray(0, at), bytes.subarray(at)]).refusal).toMatchObject({ event: 'small', maxBytes: SMALL_LIMIT });
        }
    });

    it('refuses by the length the header declares, as soon as the event name has arrived', () => {
        const payload: Buffer = packet('small', 5000);
        const bytes: Buffer = frame({ opcode: 1, payload });
        const headerBytes: number = bytes.length - payload.length;
        const eventNameEnd: number = '42["small"'.length;

        const { refusal, afterBytes } = scan(pieces(bytes, 1));

        expect(refusal).toMatchObject({ event: 'small', bytes: payload.length, maxBytes: SMALL_LIMIT });
        expect(afterBytes).toBe(headerBytes + eventNameEnd);
    });

    it('refuses by a 64 bit length before any of the payload past the event name', () => {
        const prefix: Buffer = Buffer.from('42["small",{"body":"', 'utf8');

        const { refusal } = scan([frame({ opcode: 1, payload: prefix, declaredLength: 70_000 })]);

        expect(refusal).toMatchObject({ event: 'small', bytes: 70_000, maxBytes: SMALL_LIMIT });
    });

    it('reads a 16 bit length', () => {
        expect(scan([frame({ opcode: 1, payload: packet('other', 300) })]).refusal).toBeUndefined();
        expect(scan([frame({ opcode: 1, payload: packet('small', 300) })]).refusal).toMatchObject({ bytes: packet('small', 300).length });
    });

    it('adds the fragments of a message up, and refuses at the header of the one too many', () => {
        const payload: Buffer = packet('small', 60);
        const first: Buffer = frame({ opcode: 1, fin: false, payload: payload.subarray(0, 40) });
        const second: Buffer = frame({ opcode: 0, fin: false, payload: payload.subarray(40, 60) });
        const third: Buffer = frame({ opcode: 0, fin: true, payload: Buffer.alloc(50, 'x') });

        expect(scan([first, second]).refusal).toBeUndefined();
        const { refusal, afterBytes } = scan([first, second, ...pieces(third, 1)]);
        expect(refusal).toMatchObject({ event: 'small', bytes: 110, maxBytes: SMALL_LIMIT });
        // the third fragment's header is six bytes: two, and the mask
        expect(afterBytes).toBe(first.length + second.length + 6);
    });

    it('lets a control frame between two fragments through without counting it', () => {
        const payload: Buffer = packet('small', 60);
        const ping: Buffer = frame({ opcode: 0x9, payload: Buffer.alloc(100, 'p') });

        const { refusal } = scan([
            frame({ opcode: 1, fin: false, payload: payload.subarray(0, 40) }),
            ping,
            frame({ opcode: 0, fin: true, payload: payload.subarray(40) })
        ]);

        expect(refusal).toBeUndefined();
    });

    it('starts afresh with every message', () => {
        const scanner: WebsocketFrameScanner = new WebsocketFrameScanner(new WebsocketMessageSizeScanner(resolveLimit));

        for (let i: number = 0; i < 100; i++) {
            expect(scanner.push(frame({ opcode: 1, payload: packet('small', 60) }))).toBeUndefined();
        }
        expect(scanner.push(frame({ opcode: 1, payload: packet('small', 200) }))).toMatchObject({ event: 'small' });
    });

    it('bounds a compressed message, whose event it cannot read, like one without an event', () => {
        expect(scan([frame({ opcode: 1, compressed: true, payload: packet('small', 5000) })]).refusal).toBeUndefined();
        expect(scan([frame({ opcode: 1, compressed: true, payload: packet('small', 20_000) })]).refusal)
            .toMatchObject({ event: undefined, maxBytes: OTHER_LIMIT });
    });

    it('bounds a message that carries no event, such as a ping or an acknowledgement, like one without an event', () => {
        expect(scan([frame({ opcode: 1, payload: Buffer.from('2') })]).refusal).toBeUndefined();
        expect(scan([frame({ opcode: 1, payload: Buffer.from(`43["${'x'.repeat(20_000)}"]`) })]).refusal)
            .toMatchObject({ event: undefined, maxBytes: OTHER_LIMIT });
    });

    it('counts the binary attachments of an event against what the event allows', () => {
        const event: Buffer = Buffer.from('451-["small",{"body":{"_placeholder":true,"num":0}}]', 'utf8');
        const within: Buffer = frame({ opcode: 2, payload: Buffer.alloc(SMALL_LIMIT - event.length) });
        const over: Buffer = frame({ opcode: 2, payload: Buffer.alloc(SMALL_LIMIT - event.length + 1) });

        expect(scan([frame({ opcode: 1, payload: event }), within]).refusal).toBeUndefined();
        expect(scan([frame({ opcode: 1, payload: event }), over]).refusal).toMatchObject({ event: 'small', maxBytes: SMALL_LIMIT });
    });

    it('bounds a binary message that no event announced like one without an event', () => {
        expect(scan([frame({ opcode: 2, payload: Buffer.alloc(5000) })]).refusal).toBeUndefined();
        expect(scan([frame({ opcode: 2, payload: Buffer.alloc(20_000) })]).refusal).toMatchObject({ event: undefined, maxBytes: OTHER_LIMIT });
    });

    it('bounds a message whose event name is not within its first kilobyte like one without an event', () => {
        const longName: string = 'e'.repeat(2000);

        expect(scan([frame({ opcode: 1, payload: packet(longName, 100) })]).refusal).toBeUndefined();
        expect(scan([frame({ opcode: 1, payload: packet(longName, 20_000) })]).refusal).toMatchObject({ event: undefined });
    });
});
