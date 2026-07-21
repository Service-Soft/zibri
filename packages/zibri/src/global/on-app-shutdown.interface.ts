import { ShutdownSignal, ZibriApplication } from '../application';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * Runs when the app shuts down.
 */
export interface OnAppShutdown {
    /**
     * Runs when the app shuts down.
     */
    onAppShutdown: (app: ZibriApplication, signal: ShutdownSignal | undefined) => void | Promise<void>,
    /**
     * The timeout for after which the graceful shutdown should fail.
     * @default 30 seconds
     */
    readonly shutdownTimeoutInMs?: number
}

/**
 * An error to throw when something crashed during shutdown.
 */
export class OnAppShutdownError extends InternalError {
    constructor(context: string, options: ErrorOptions) {
        super(`Error running onAppShutdown for "${context}":`, options);
        this.name = 'OnAppShutdownError';
    }
}

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given value implements the OnAppShutdown interface.
 * @param value - The value to check.
 */
export function implementsOnAppShutdown(value: unknown): value is OnAppShutdown {
    if (typeof value !== 'object') {
        return false;
    }
    if (value == undefined) {
        return false;
    }
    if (!('onAppShutdown' in value)) {
        return false;
    }

    if (typeof value.onAppShutdown !== 'function') {
        return false;
    }
    return true;
}