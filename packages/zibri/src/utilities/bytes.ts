/* eslint-disable typescript/typedef */
/**
 * Sizes in bytes, for options that take one, such as `5 * Bytes.MB`.
 */
export abstract class Bytes {
    /**
     * One byte.
     */
    static B = 1 as const;
    /**
     * The amount of bytes in a kilobyte.
     */
    static KB = 1000 as const;
    /**
     * The amount of bytes in a megabyte.
     */
    static MB = 1_000_000 as const;
    /**
     * The amount of bytes in a gigabyte.
     */
    static GB = 1_000_000_000 as const;
}