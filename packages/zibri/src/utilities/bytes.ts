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

    /**
     * A size as a person reads it, in the largest unit it fills, such as `112.4 GB`.
     * @param bytes - The size.
     * @returns The size, one decimal from a megabyte on.
     */
    static format(bytes: number): string {
        if (bytes >= Bytes.GB) {
            return `${(bytes / Bytes.GB).toFixed(1)} GB`;
        }
        if (bytes >= Bytes.MB) {
            return `${(bytes / Bytes.MB).toFixed(1)} MB`;
        }
        return bytes >= Bytes.KB
            ? `${Math.ceil(bytes / Bytes.KB)} KB`
            : `${Math.max(0, Math.ceil(bytes))} B`;
    }
}