/**
 * Runs only on client side.
 * @param fn - The fn to run on the client side.
 */
export function onClient<T extends void | Promise<void>>(fn: () => T): void {
    if (typeof window !== 'object') {
        return;
    }
    void fn();
}