/**
 * Utilities for writing html by hand.
 */
export abstract class HtmlUtilities {
    /**
     * Escapes a value for the text of an element or a double quoted attribute.
     * @param value - The value.
     * @returns The value, with the characters html reads as markup escaped.
     */
    static escape(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }
}