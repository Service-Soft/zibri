/* eslint-disable typescript/typedef */
// eslint-disable-next-line jsdoc/require-jsdoc
export abstract class Bytes {
    /**
     * The amount of ms in a second.
     */
    static B = 1 as const;
    /**
     * The amount of ms in a minute.
     */
    static KB = 1000 as const;
    /**
     * The amount of ms in an hour.
     */
    static MB = 1_000_000 as const;
    /**
     * The amount of ms in a day.
     */
    static GB = 1_000_000_000 as const;
}