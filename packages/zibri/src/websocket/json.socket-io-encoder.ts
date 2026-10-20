import type { Packet } from 'socket.io-parser';

import { JsonUtilities } from '../utilities/json.utilities.ts';

/**
 * Writes every packet the server sends as the one json string socket.io's protocol carries it in.
 *
 * A value json has no form for is written the way {@link JsonUtilities.stringify} writes it, so a
 * bigint arrives as its digits and a date as its iso string, whichever way the message is sent.
 */
export class JsonSocketIoEncoder {
    /**
     * Encodes one packet.
     * @param packet - The packet to send.
     * @returns The packet as the single string it is sent as.
     */
    encode(packet: Packet): string[] {
        // socket.io's own encoder looks for binary first and sends a buffer beside the json. Not
        // here: a message is stored as json and replayed from there when a client reconnects, and
        // it reaches the clients of another instance as json, so a buffer sent as binary to the
        // clients of this instance alone would reach them differently from everyone else. Written
        // as json it is `{ type: 'Buffer', data }` for every one of them.
        //
        // What is left is the protocol's string form: the type, the namespace unless it is the
        // default one, the acknowledgement id, then the data.
        let encoded: string = `${packet.type}`;
        if (packet.nsp !== '/') {
            encoded += `${packet.nsp},`;
        }
        if (packet.id != undefined) {
            encoded += `${packet.id}`;
        }
        if (packet.data != undefined) {
            encoded += JsonUtilities.stringify(packet.data);
        }
        return [encoded];
    }
}