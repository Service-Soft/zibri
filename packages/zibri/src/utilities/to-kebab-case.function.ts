/**
 * Transforms the given input string into kebab case.
 * @param input - The string to transform.
 * @returns The given input in kebab case.
 */
export function toKebabCase(input: string): string {
    return input.trim()
        .replaceAll(/([\da-z])([A-Z])/g, '$1-$2')
        .replaceAll(/([A-Z])([A-Z][\da-z])/g, '$1-$2')
        .replaceAll(/[\s.\-]+/g, '-')
        .replaceAll(/__+/g, '-')
        .replaceAll('_', '-')
        .replaceAll('/', '-')
        .replaceAll('\\', '-')
        .replaceAll('{', '-')
        .replaceAll('}', '-')
        .replaceAll(/^-+|-+$/g, '')
        .toLowerCase();
}