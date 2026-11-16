/**
 * Reads the html the site renders.
 */
export abstract class HtmlUtilities {
    /**
     * Text or an attribute value as the browser reads it, for the entities a render writes into one.
     * @param value - The value as written.
     * @returns The value.
     */
    static decode(value: string): string {
        return value
            .replaceAll('&quot;', '"')
            .replaceAll('&#39;', '\'')
            .replaceAll('&lt;', '<')
            .replaceAll('&gt;', '>')
            .replaceAll('&amp;', '&');
    }
}