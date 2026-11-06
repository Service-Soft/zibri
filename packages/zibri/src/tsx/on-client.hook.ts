/**
 * Runs only on client side.
 * @param fn - The fn to run on the client side. It may return a cleanup, which runs when the component is removed from
 * the page, such as with the branch or the row of markup that follows a state.
 */
export function onClient<T extends void | Promise<void> | (() => void)>(fn: () => T): void {
    if (typeof window !== 'object') {
        return;
    }
    void fn();
}
