import { ZibriApplication } from '../application';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the BeforeAppInit interface.
 * @param value - The value to check.
 */
export function implementsBeforeAppInit(value: unknown): value is BeforeAppInit {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('beforeAppInit' in value)) {
        return false;
    }

    if (typeof value.beforeAppInit !== 'function') {
        return false;
    }
    return true;
}

/**
 * Runs just before the app initializes.
 * This is useful for things like the data source service, which other services might rely on being available on initialization.
 *
 * In most cases you probably want to implement OnAppInit, as your service probably does not fall in that category.
 */
export interface BeforeAppInit {
    /**
     * Runs just before the app initializes.
     * This is useful for things like the data source service, which other services might rely on being available on initialization.
     *
     * In most cases you probably want to implement OnAppInit, as your service probably does not fall in that category.
     */
    beforeAppInit: (app: ZibriApplication) => void | Promise<void>
}