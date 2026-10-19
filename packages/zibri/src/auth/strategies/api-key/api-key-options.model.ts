/**
 * How often the last use of an api key is written down, and how long an expired key is kept.
 */
export type ApiKeyOptions = {
    /**
     * How long after the last use that was written down the next one is. 0 writes down every use.
     * @default 3600000
     */
    recordUseAfterMs?: number,
    /**
     * How long after it expired a key is deleted. Until then it is listed, as expired.
     * @default 2592000000
     */
    deleteExpiredAfterMs?: number
};