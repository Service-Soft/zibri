import { ZibriApplication } from '../application/application';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the AfterAppStart interface.
 * @param value - The value to check.
 */
export function implementsAfterAppStart(value: unknown): value is AfterAppStart {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('afterAppStart' in value)) {
        return false;
    }

    if (typeof value.afterAppStart !== 'function') {
        return false;
    }
    return true;
}

/**
 * Runs once the app is accepting requests.
 *
 * The only hook that runs after the port is bound, which is what makes it the place for work that
 * should not begin until the instance can actually be reached. Everything earlier - including
 * `onAppStart` - runs while the socket is still closed, so an instance doing that work may be one no
 * readiness probe has passed and no operator has decided to keep.
 *
 * Connecting and being ready are separate things, and this is the seam between them.
 */
export interface AfterAppStart {
    /**
     * Runs once the app is accepting requests.
     */
    afterAppStart: (app: ZibriApplication) => void | Promise<void>
}