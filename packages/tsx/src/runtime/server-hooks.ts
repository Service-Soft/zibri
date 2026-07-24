/**
 * Server-side implementations of the framework lifecycle hooks that a compiled component's server
 * render may call. `onClient` callbacks never run on the server; `onServer` callbacks always do.
 * (The client counterparts are inlined into the generated client script instead.).
 */
export type ServerHooks = {
    /**
     * Skips the callback — it belongs to the browser.
     */
    onClient: (fn: () => unknown) => void,
    /**
     * Runs the callback on the server.
     */
    onServer: (fn: () => unknown) => void
};

/**
 * The server-side lifecycle hook implementations injected into a compiled component's scope.
 */
export const SERVER_HOOKS: ServerHooks = {
    onClient: () => undefined,
    onServer: (fn: () => unknown) => {
        fn();
    }
};