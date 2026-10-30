/**
 * How often the last use of an api key is written down, how long an expired key is kept, and what
 * every key starts with.
 */
export type ApiKeyOptions = {
    /**
     * What every key starts with, which tells a key sent as a bearer token apart from a jwt, and lets a
     * secret scanner find one that leaked. Letters and digits, ending in `_`.
     * @default 'zibri_'
     */
    prefix?: string,
    /**
     * How long after the last use that was written down the next one is. 0 writes down every use.
     * @default 3600000
     */
    recordUseAfterInMs?: number,
    /**
     * How long after it expired a key is deleted. Until then it is listed, as expired.
     * @default 2592000000
     */
    deleteExpiredAfterInMs?: number
};