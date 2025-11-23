import { encode } from 'hi-base32';

/**
 * Encapsulates functionality of the hi-base32 package.
 */
export abstract class HiBase32Utilities {
    /**
     * Encode the given input to a base32 string.
     * @param input - The input you want to encode.
     * @param asciiOnly - Treat string as ASCII or UTF-8 string. Default is false.
     * @returns The encoded base32 string.
     */
    static encode(input: string | number[] | ArrayBuffer | Uint8Array, asciiOnly?: boolean): string {
        return encode(input, asciiOnly);
    }
}