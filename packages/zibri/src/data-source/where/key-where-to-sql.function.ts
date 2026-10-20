import { BaseEntity } from '../../entity/base-entity.model.ts';
import { KeyWhere } from '../../entity/models/unique-declaration.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { literalToSql } from '../literal-to-sql.function.ts';

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
 * The operators a key's filter may use, beside a plain value.
 */
const KEY_WHERE_OPERATORS: Set<string> = new Set([
    'not',
    'oneOf',
    'notOneOf',
    'greaterThan',
    'greaterThanEquals',
    'lesserThan',
    'lesserThanEquals'
]);

/**
 * The sql of each comparison a key's filter may make.
 */
const KEY_WHERE_COMPARISONS: Record<string, string> = {
    greaterThan: '>',
    greaterThanEquals: '>=',
    lesserThan: '<',
    lesserThanEquals: '<='
};

/**
 * Turns the filter a key or a check was declared with into the predicate the schema holds.
 *
 * Deliberately narrow: a property compared against a literal - equal to it, `not` it, one of a list
 * or none of it, and a number greater or lesser than it - and nothing else. A predicate lives in the
 * schema rather than in a query, so it cannot carry a parameter and has to be written into the
 * statement - and everything a richer filter would add (a subquery, a function, a value decided at
 * boot) is something the database has to be able to prove immutable before it will index or check
 * on it. Refusing the rest here means a declaration that cannot work says so, rather than arriving as
 * whatever the store makes of it.
 *
 * Null is answered the way the in process evaluator answers it, so a store that judges the filter
 * itself agrees with this predicate: `not` and `notOneOf` match a row holding none unless they name
 * null, and a comparison never does. A comparison of null is NULL in sql, which an index predicate
 * reads as false; a check has to say `IS TRUE` around the predicate to read it the same way. Numbers
 * alone are compared by size, since the order of text is the store's collation.
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
            `${ownerName}: The filter of a unique or check declaration names "${key}",`,
            'which the entity does not declare as a property.'
        ]);
    }
    // a column is named as written rather than lower cased, because nothing renames columns on the
    // way into the schema - so an unquoted identifier would be folded to lower case and miss
    const column: string = `"${key}"`;
    if (isKeyWhereValue(value)) {
        return value === null ? `${column} IS NULL` : `${column} = ${literalToSql(value)}`;
    }
    const operators: [string, unknown][] = typeof value === 'object' && value != undefined && !Array.isArray(value)
        ? Object.entries(value).filter(([, v]) => v !== undefined)
        : [];
    if (!operators.length || operators.some(([operator]) => !KEY_WHERE_OPERATORS.has(operator))) {
        throw new InternalError([
            `${ownerName}.${key}: The filter of a unique or check declaration can only compare a property against a string,`,
            'number, boolean or null - as it is, or with "not", "oneOf", "notOneOf" or a comparison of numbers.',
            `Received ${JsonUtilities.stringify(value)}, which a schema predicate cannot be built from.`
        ]);
    }
    const conditions: string[] = operators.map(([operator, operand]) => operatorToSql(`${ownerName}.${key}`, column, operator, operand));
    return conditions.length > 1 ? `(${conditions.join(' AND ')})` : conditions.join('');
}

/**
 * Turns one operator and its operand into sql, answering null as the in process evaluator does.
 * @param name - The entity and property, named in what it refuses.
 * @param column - The column, quoted.
 * @param operator - The operator.
 * @param operand - What it compares against.
 * @returns The condition as sql.
 * @throws When the operand is not one the operator can be written with.
 */
function operatorToSql(name: string, column: string, operator: string, operand: unknown): string {
    const comparison: string | undefined = KEY_WHERE_COMPARISONS[operator];
    if (comparison != undefined) {
        if (typeof operand !== 'number') {
            throw new InternalError([
                `${name}: "${operator}" in the filter of a unique or check declaration compares numbers only.`,
                `Received ${JsonUtilities.stringify(operand)}.`
            ]);
        }
        return `${column} ${comparison} ${literalToSql(operand)}`;
    }
    if (operator === 'not') {
        if (!isKeyWhereValue(operand)) {
            throw new InternalError([
                `${name}: "not" in the filter of a unique or check declaration takes a string, number, boolean or null.`,
                `Received ${JsonUtilities.stringify(operand)}.`
            ]);
        }
        // a row holding none is not the value named
        return operand === null ? `${column} IS NOT NULL` : `${column} IS DISTINCT FROM ${literalToSql(operand)}`;
    }
    return listOperatorToSql(name, column, operator, operand);
}

/**
 * Turns "oneOf" or "notOneOf" and its list into sql, answering null as the in process evaluator does.
 * @param name - The entity and property, named in what it refuses.
 * @param column - The column, quoted.
 * @param operator - "oneOf" or "notOneOf".
 * @param operand - What it compares against.
 * @returns The condition as sql.
 * @throws When the operand is not a list of values the operator can be written with.
 */
function listOperatorToSql(name: string, column: string, operator: string, operand: unknown): string {
    if (!Array.isArray(operand) || !operand.every(isKeyWhereValue)) {
        throw new InternalError([
            `${name}: "${operator}" in the filter of a unique or check declaration takes a list of strings, numbers, booleans or null.`,
            `Received ${JsonUtilities.stringify(operand)}.`
        ]);
    }
    // eslint-disable-next-line unicorn/no-null
    const listsNull: boolean = operand.includes(null);
    const listed: string[] = operand.filter(v => v !== null).map(v => literalToSql(v));
    if (operator === 'oneOf') {
        const parts: string[] = [
            ...listed.length ? [`${column} IN (${listed.join(', ')})`] : [],
            ...listsNull ? [`${column} IS NULL`] : []
        ];
        return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
    }
    // notOneOf: a row holding none is none of the values, unless null is listed
    if (!listed.length) {
        return listsNull ? `${column} IS NOT NULL` : 'TRUE';
    }
    return listsNull
        ? `(${column} IS NOT NULL AND ${column} NOT IN (${listed.join(', ')}))`
        : `(${column} IS NULL OR ${column} NOT IN (${listed.join(', ')}))`;
}

/**
 * Whether a value is one a schema predicate can compare against.
 * @param value - The value to check.
 * @returns True when it is a literal this can write.
 */
function isKeyWhereValue(value: unknown): value is KeyWhereValue {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}