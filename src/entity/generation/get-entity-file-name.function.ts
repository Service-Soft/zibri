import { toKebabCase } from '../../utilities/to-kebab-case.function';

/**
 * Gets the file name for the given entity name.
 * @param prefix - The prefix that should be added to the name.
 * @param name - The actual name of the entity.
 * @returns The full file name of the entity.
 */
export function getEntityFileName(prefix: string, name: string): string {
    return `${toKebabCase(prefix)}.${toKebabCase(name)}.model.ts`;
}