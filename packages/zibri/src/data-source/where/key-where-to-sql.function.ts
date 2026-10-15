import { BaseEntity } from '../../entity/base-entity.model';
import { KeyWhere } from '../../entity/models/unique-declaration.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { literalToSql } from '../literal-to-sql.function';

/**
 * The values a key's filter may compare against.
 */
type KeyWhereValue = string | number | boolean | null;

/**
 * What a key is declared on when there is no entity class to read it off, like a table a migration
 * describes as it was in an earlier release.
 */
type KeyWhereOwner = {
    /**
     * The name to report a refused filter under.
     */
    name: string,
    /**
     * The properties a filter may compare.
     */
    properties: string[]
};

/**
 * Turns the filter a key was declared with into the predicate its index is created with.
 *
 * Deliberately narrow: equality against a literal, and nothing else. A predicate lives in the schema
 * rather than in a query, so it cannot carry a parameter and has to be written into the statement -
 * and everything a richer filter would add (a subquery, a function, a value decided at boot) is
 * something the database has to be able to prove immutable before it will index on it. Refusing the
 * rest here means a declaration that cannot work says so while the schema is built, rather than
 * arriving as whatever the store makes of it.
 * @param owner - The entity the key is declared on, or its name and properties.
 * @param where - The filter it was declared with.
 * @returns The sql predicate, without the `WHERE` keyword.
 * @throws When the filter asks for something a schema predicate cannot express.
 */
export function keyWhereToSql<T extends BaseEntity>(owner: Newable<T> | KeyWhereOwner, where: KeyWhere): string {
    const properties: Set<string> = new Set(
        typeof owner === 'function' ? Object.keys(MetadataUtilities.getModelProperties(owner)) : owner.properties
    );
    const branches: object[] = Array.isArray(where) ? where : [where];

    const parts: string[] = branches.map(branch => {
        const conditions: string[] = Object.entries(branch).map(
            ([key, value]) => conditionToSql(owner.name, properties, key, value)
        );
        return conditions.length > 1 ? `(${conditions.join(' AND ')})` : conditions.join(' AND ');
    });
    return parts.length > 1 ? parts.join(' OR ') : parts.join('');
}

/**
 * Turns one property and the value it is compared against into sql.
 * @param ownerName - The entity the key is declared on, named in what it refuses.
 * @param properties - The entity's properties.
 * @param key - The property being compared.
 * @param value - The value it is compared against.
 * @returns The condition as sql.
 * @throws When the property is not one the entity stores, or the value is not a literal.
 */
function conditionToSql(ownerName: string, properties: Set<string>, key: string, value: unknown): string {
    if (!properties.has(key)) {
        throw new InternalError([
            `${ownerName}: The filter of a unique or index declaration names "${key}",`,
            'which the entity does not declare as a property.'
        ]);
    }
    if (!isKeyWhereValue(value)) {
        throw new InternalError([
            `${ownerName}.${key}: The filter of a unique or index declaration can only compare a property`,
            'against a string, number, boolean or null.',
            `Received ${JsonUtilities.stringify(value)}, which a schema predicate cannot be built from.`
        ]);
    }
    // a column is named as written rather than lower cased, because nothing renames columns on the
    // way into the schema - so an unquoted identifier would be folded to lower case and miss
    if (value === null) {
        return `"${key}" IS NULL`;
    }
    return `"${key}" = ${literalToSql(value)}`;
}

/**
 * Whether a value is one a schema predicate can compare against.
 * @param value - The value to check.
 * @returns True when it is a literal this can write.
 */
function isKeyWhereValue(value: unknown): value is KeyWhereValue {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}