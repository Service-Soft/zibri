/**
 * Transforms the given input string into pascal case.
 * @param input - The string to transform.
 * @returns The given input in pascal case.
 */
export function toPascalCase(input: string): string {
    return input
        .replaceAll(/[_\-]+/g, ' ')
        .replaceAll('/', ' ')
        .replaceAll(/^\w|[A-Z]|\b\w/g, (w) => w.toUpperCase())
        .replaceAll(/\s+/g, '');
}