/**
 * Transforms the given input string into camel case.
 * @param input - The string to transform.
 * @returns The given input in camel case.
 */
export function toCamelCase(input: string): string {
    if (!input) {
        return '';
    }
    const normalized: string = input
        .replaceAll(/([\da-z])([A-Z])/g, '$1 $2') // split camel/Pascal transitions
        .replaceAll(/[._\-]+/g, ' ')
        .trim();
    const parts: string[] = normalized.split(/\s+/);
    if (parts.length === 0) {
        return '';
    }
    const first: string = parts[0].toLowerCase();
    const rest: string = parts
        .slice(1)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join('');
    return first + rest;
}