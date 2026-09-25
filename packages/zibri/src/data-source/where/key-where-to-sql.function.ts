import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { KeyWhere } from '../../entity/models/unique-declaration.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * The values a key's filter may compare against.
 */
type KeyWhereValue = string | number | boolean | null;

/**
 * Turns the filter a key was declared with into the predicate its index is created with.
 *
 * Deliberately narrow: equality against a literal, and nothing else. A predicate lives in the schema
 * rather than in a query, so it cannot carry a parameter and has to be written into the statement -
 * and everything a richer filter would add (a subquery, a function, a value decided at boot) is
 * something the database has to be able to prove immutable before it will index on it. Refusing the
 * rest here means a declaration that cannot work says so while the schema is built, rather than
 * arriving as whatever the store makes of it.
 * @param entityClass - The entity the key is declared on.
 * @param where - The filter it was declared with.
 * @returns The sql predicate, without the `WHERE` keyword.
 * @throws When the filter asks for something a schema predicate cannot express.
 */
export function keyWhereToSql<T extends BaseEntity>(entityClass: Newable<T>, where: KeyWhere): string {
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
    const branches: object[] = Array.isArray(where) ? where : [where];

    const parts: string[] = branches.map(branch => {
        const conditions: string[] = Object.entries(branch).map(
            ([key, value]) => conditionToSql(entityClass, properties, key, value)
        );
        return conditions.length > 1 ? `(${conditions.join(' AND ')})` : conditions.join(' AND ');
    });
    return parts.length > 1 ? parts.join(' OR ') : parts.join('');
}

/**
 * Turns one property and the value it is compared against into sql.
 * @param entityClass - The entity the key is declared on, named in what it refuses.
 * @param properties - What the entity's properties declare.
 * @param key - The property being compared.
 * @param value - The value it is compared against.
 * @returns The condition as sql.
 * @throws When the property is not one the entity stores, or the value is not a literal.
 */
function conditionToSql<T extends BaseEntity>(
    entityClass: Newable<T>,
    properties: Record<string, PropertyMetadata>,
    key: string,
    value: unknown
): string {
    if (!(key in properties)) {
        throw new InternalError([
            `${entityClass.name}: The filter of a unique or index declaration names "${key}",`,
            'which the entity does not declare as a property.'
        ]);
    }
    if (!isKeyWhereValue(value)) {
        throw new InternalError([
            `${entityClass.name}.${key}: The filter of a unique or index declaration can only compare a property`,
            'against a string, number, boolean or null.',
            `Received ${JSON.stringify(value)}, which a schema predicate cannot be built from.`
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

/**
 * Writes a literal into a statement.
 * @param value - The value to write.
 * @returns The value as sql.
 * @throws When a number cannot be written as a literal at all.
 */
function literalToSql(value: Exclude<KeyWhereValue, null>): string {
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new InternalError(`The filter of a unique or index declaration cannot compare against ${value}.`);
        }
        return String(value);
    }
    // escaped even though this comes from a declaration rather than from a request: a value reaching
    // a statement unescaped is the shape of C5, and a declaration is only trusted until somebody
    // builds one out of configuration
    const escaped: string = value.replaceAll('\'', '\'\'');
    return `'${escaped}'`;
}