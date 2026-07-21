import { ZibriApplication } from '../application';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the AfterAppInit interface.
 * @param value - The value to check.
 */
export function implementsAfterAppInit(value: unknown): value is AfterAppInit {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('afterAppInit' in value)) {
        return false;
    }

    if (typeof value.afterAppInit !== 'function') {
        return false;
    }
    return true;
}

/**
 * Runs just after the app initializes.
 * This is useful for things like the cron or websocket service,
 * which creates new work that might rely on other services already being operational.
 *
 * In most cases you probably want to implement OnAppInit.
 * Most relevant things like eg. The data source service are already operational there, as they implement the BeforeAppInit interface.
 */
export interface AfterAppInit {
    /**
     * Runs just after the app initializes.
     * This is useful for things like the cron or websocket service,
     * which creates new work that might rely on other services already being operational.
     *
     * In most cases you probably want to implement OnAppInit.
     * Most relevant things like eg. The data source service are already operational there, as they implement the BeforeAppInit interface.
     */
    afterAppInit: (app: ZibriApplication) => void | Promise<void>
}