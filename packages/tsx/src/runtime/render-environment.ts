/**
 * Where a page is rendered, which decides what a mistake only the render can see does: `development`
 * throws, so a test rendering it fails, and `production` logs it, naming the component, and renders the page
 * with the broken part degraded, so a user gets the page rather than an error.
 */
export type RenderEnvironment = 'development' | 'production';

/**
 * Reports a mistake only the render can see.
 * @param environment - Where the page is rendered.
 * @param message - What is wrong, naming the component.
 * @throws An Error with the message, in `development`.
 */
export function reportRenderMistake(environment: RenderEnvironment, message: string): void {
    if (environment === 'development') {
        throw new Error(message);
    }
    // eslint-disable-next-line no-console
    console.error(`zibri-tsx: ${message}`);
}