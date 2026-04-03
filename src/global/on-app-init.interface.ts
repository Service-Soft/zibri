import { ZibriApplication } from '../application';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the OnAppInit interface.
 * @param value - The value to check.
 */
export function implementsOnAppInit(value: unknown): value is OnAppInit {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('onAppInit' in value)) {
        return false;
    }

    if (typeof value.onAppInit !== 'function') {
        return false;
    }
    return true;
}

/**
 * Runs when the app initializes.
 */
export interface OnAppInit {
    /**
     * Runs when the app initializes.
     */
    onAppInit: (app: ZibriApplication) => void | Promise<void>
}