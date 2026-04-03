import { ZibriApplication } from '../application';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the OnAppStart interface.
 * @param value - The value to check.
 */
export function implementsOnAppStart(value: unknown): value is OnAppStart {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('onAppStart' in value)) {
        return false;
    }

    if (typeof value.onAppStart !== 'function') {
        return false;
    }
    return true;
}

/**
 * Runs when the app starts.
 */
export interface OnAppStart {
    /**
     * Runs when the app starts.
     */
    onAppStart: (app: ZibriApplication) => void | Promise<void>
}