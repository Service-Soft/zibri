/**
 * Transforms the given input string into snake case.
 * @param input - The string to transform.
 * @returns The given input in snake case.
 */
export function toSnakeCase(input: string): string {
    return input.trim()
        .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
        .replaceAll(/([A-Z])([A-Z][\da-z])/g, '$1_$2')
        .replaceAll(/[\s.\-]+/g, '_')
        .replaceAll(/__+/g, '_')
        .replaceAll(/^_+|_+$/g, '')
        .toLowerCase();
}