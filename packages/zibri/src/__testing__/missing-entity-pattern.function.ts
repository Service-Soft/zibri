/**
 * Matches the line of a refused boot that names an entity no data source declares, together with
 * one of what requires it.
 * @param entity - The name of the entity.
 * @param requiredBy - The name of one of what requires it.
 * @returns The pattern.
 */
export function missingEntityPattern(entity: string, requiredBy: string): RegExp {
    return new RegExp(`- ${entity} \\(required by (?:[^)]* )?${requiredBy}[,) ]`);
}
