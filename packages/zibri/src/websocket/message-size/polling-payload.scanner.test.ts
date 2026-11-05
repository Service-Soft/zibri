import { describe, expect, it } from '@jest/globals';

import { PollingPayloadScanner } from './polling-payload.scanner';
import { WebsocketMessageLimitResolver, WebsocketMessageRefusal, WebsocketMessageSizeScanner } from './websocket-message-size.scanner';

/**
 * What a message of each event may weigh here: `small` a hundred bytes, anything else ten thousand.
 */
const SMALL_LIMIT: number = 100;
const OTHER_LIMIT: number = 10_000;
const resolveLimit: WebsocketMessageLimitResolver = event => event === 'small' ? SMALL_LIMIT : OTHER_LIMIT;

/**
 * What separates the packets of one request.
 */
const SEPARATOR: string = '\u001E';

/**
 * The packet of an event whose body is a text of the given length.
 * @param event - The event.
 * @param length - How long the text is.
 * @returns The packet.
 */
function packet(event: string, length: number): string {
    return `42["${event}",{"body":"${'x'.repeat(length)}"}]`;
}

/**
 * Pushes a body through a fresh scanner, in pieces of the given size, as one request.
 * @param body - The body.
 * @param pieceSize - The size of a piece.
 * @param sizes - The scanner of the session, to share one between requests.
 * @returns The refusal, if any.
 */
function scan(body: string, pieceSize: number, sizes: WebsocketMessageSizeScanner = new WebsocketMessageSizeScanner(resolveLimit)): WebsocketMessageRefusal | undefined {
    const scanner: PollingPayloadScanner = new PollingPayloadScanner(sizes);
    for (let i: number = 0; i < body.length; i += pieceSize) {
        const refusal: WebsocketMessageRefusal | undefined = scanner.push(body.slice(i, i + pieceSize));
        if (refusal != undefined) {
            return refusal;
        }
    }
    scanner.end();
    return undefined;
}

describe('PollingPayloadScanner', () => {

    it('takes a packet within what its event allows, however the body is cut', () => {
        const body: string = packet('small', 50);
        for (const pieceSize of [1, 7, body.length]) {
            expect(scan(body, pieceSize)).toBeUndefined();
        }
    });

    it('refuses a packet over what its event allows, however the body is cut', () => {
        const body: string = packet('small', 200);
        for (const pieceSize of [1, 7, body.length]) {
            expect(scan(body, pieceSize)).toMatchObject({ event: 'small', maxBytes: SMALL_LIMIT });
        }
    });

    it('measures each packet of a request on its own', () => {
        const within: string = [packet('small', 50), packet('other', 5000), packet('small', 50)].join(SEPARATOR);
        const over: string = [packet('small', 50), packet('other', 5000), packet('small', 200)].join(SEPARATOR);

        expect(scan(within, 13)).toBeUndefined();
        expect(scan(over, 13)).toMatchObject({ event: 'small', maxBytes: SMALL_LIMIT });
    });

    it('bounds a packet that carries no event like one without an event', () => {
        expect(scan('2', 1)).toBeUndefined();
        expect(scan(`43["${'x'.repeat(20_000)}"]`, 4096)).toMatchObject({ event: undefined, maxBytes: OTHER_LIMIT });
    });

    it('counts a binary attachment sent in a later request against the event of the request before', () => {
        const sizes: WebsocketMessageSizeScanner = new WebsocketMessageSizeScanner(resolveLimit);
        const event: string = '451-["small",{"body":{"_placeholder":true,"num":0}}]';
        const attachment: string = `b${Buffer.alloc(SMALL_LIMIT).toString('base64')}`;

        expect(scan(event, 10, sizes)).toBeUndefined();
        expect(scan(attachment, 10, sizes)).toMatchObject({ event: 'small', maxBytes: SMALL_LIMIT });
    });

    it('bounds a binary attachment no event announced like one without an event', () => {
        expect(scan(`b${Buffer.alloc(5000).toString('base64')}`, 1000)).toBeUndefined();
        expect(scan(`b${Buffer.alloc(20_000).toString('base64')}`, 1000)).toMatchObject({ event: undefined, maxBytes: OTHER_LIMIT });
    });
});