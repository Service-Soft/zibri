/**
 * Runs only on server side.
 * @param fn - The fn to run on the server side.
 */
export function onServer<T extends void | Promise<void>>(fn: () => T): void {
    if (typeof window === 'object') {
        return;
    }
    void fn();
}