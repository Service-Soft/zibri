
const ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LOOKUP: Uint8Array<ArrayBuffer> = new Uint8Array(256).fill(0xFF);
for (let i: number = 0; i < ALPHABET.length; i++) {
    LOOKUP[ALPHABET.charCodeAt(i)] = i;
}

/**
 * Encodes the given input as a base32 string.
 * @param input - The data to encode.
 * @returns A base32 string of the given input.
 */
export function base32Encode(input: Buffer): string {
    let bits: number = 0;
    let value: number = 0;
    let output: string = '';

    for (const byte of input) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += ALPHABET[(value << (5 - bits)) & 31];
    }
    while (output.length % 8 !== 0) {
        output += '=';
    }
    return output;
}