import { ShutdownSignal, ZibriApplication } from '../application';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * Runs just before the app shuts down.
 * This is useful for things like the cron or websocket service,
 * which creates new work that might rely on other services still being operational.
 *
 * In most cases you probably want to implement OnAppShutdown.
 * Most relevant things like eg. The data source service are still operational there, as they implement the AfterAppShutdown interface.
 */
export interface BeforeAppShutdown {
    /**
     * Runs just before the app shuts down.
     * This is useful for things like the cron or websocket service,
     * which creates new work that might rely on other services still being operational.
     *
     * In most cases you probably want to implement OnAppShutdown.
     * Most relevant things like eg. The data source service are still operational there, as they implement the AfterAppShutdown interface.
     */
    beforeAppShutdown: (app: ZibriApplication, signal: ShutdownSignal | undefined) => void | Promise<void>,
    /**
     * The timeout for after which the graceful shutdown should fail.
     * @default 30 seconds
     */
    readonly shutdownTimeoutInMs?: number
}

/**
 * An error to throw when something crashed before shutdown.
 */
export class BeforeAppShutdownError extends InternalError {
    constructor(context: string, options: ErrorOptions) {
        super(`Error running beforeAppShutdown for "${context}":`, options);
        this.name = 'BeforeAppShutdownError';
    }
}

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the BeforeAppShutdown interface.
 * @param value - The value to check.
 */
export function implementsBeforeAppShutdown(value: unknown): value is BeforeAppShutdown {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('beforeAppShutdown' in value)) {
        return false;
    }

    if (typeof value.beforeAppShutdown !== 'function') {
        return false;
    }
    return true;
}