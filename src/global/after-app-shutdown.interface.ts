import { ShutdownSignal, ZibriApplication } from '../application';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * Runs just after the app shuts down.
 * This is useful for things like the data source service,
 * which should still be available at the OnAppShutdown hooks.
 *
 * In most cases you probably want to implement OnAppShutdown.
 */
export interface AfterAppShutdown {
    /**
     * Runs just after the app shuts down.
     * This is useful for things like the data source service,
     * which should still be available at the OnAppShutdown hooks.
     *
     * In most cases you probably want to implement OnAppShutdown.
     */
    afterAppShutdown: (app: ZibriApplication, signal: ShutdownSignal | undefined) => void | Promise<void>,
    /**
     * The timeout for after which the graceful shutdown should fail.
     * @default 30 seconds
     */
    readonly shutdownTimeoutInMs?: number
}

/**
 * An error to throw when something crashed after shutdown.
 */
export class AfterAppShutdownError extends InternalError {
    constructor(context: string, options: ErrorOptions) {
        super(`Error running afterAppShutdown for "${context}":`, options);
        this.name = 'AfterAppShutdownError';
    }
}

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the AfterAppShutdown interface.
 * @param value - The value to check.
 */
export function implementsAfterAppShutdown(value: unknown): value is AfterAppShutdown {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('afterAppShutdown' in value)) {
        return false;
    }

    if (typeof value.afterAppShutdown !== 'function') {
        return false;
    }
    return true;
}