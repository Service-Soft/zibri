import { ShutdownSignal, ZibriApplication } from '../application';

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