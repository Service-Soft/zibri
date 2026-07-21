import { CookieOptions as ExpressCookieOptions } from 'express';

/**
 * Options for a cookie.
 */
export type CookieOptions = ExpressCookieOptions & {
    /**
     * The name of the cookie.
     */
    name: string
};