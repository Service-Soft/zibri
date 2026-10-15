import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Relation } from '../../entity/models/relation.enum';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WhereFilter } from '../models/where/where-filter.model';
import { ScopeWhereUtilities } from '../scopes/scope-where.utilities';

/**
 * The marker returned for a condition no stored value can satisfy.
 */
const IMPOSSIBLE: unique symbol = Symbol('impossible');

/**
 * Removes from a filter the conditions that no row could satisfy, because the value asked for is not
 * one the property is able to hold.
 *
 * A property declares its format, so a value outside that format names no row - and answering with
 * none of them is both the true answer and the one a store that filters in process already gives. A
 * store that types its columns instead refuses the value outright, which turns a mistyped query
 * parameter into a failed request rather than an empty result. Deciding it here is what makes the two
 * agree.
 *
 * **Only ever narrows.** A value is dropped where dropping it can only remove rows from the answer:
 * an equality, or one option out of a list of them. A negation of such a value is refused instead,
 * because every row differs from it: acting on it would widen the filter - the one direction a
 * mistake here must never take - and leaving it would hand the store a value it refuses.
 *
 * A relation is judged by the ids of the entities a filter on it names, under the same rule, and a
 * filter reaching through a relation to one entity is narrowed by the properties of that entity.
 *
 * Every uuid the filter asks for comes back in lower case, the form every write stores it in.
 * @param branches - The filter to narrow, as the branches it is an OR of.
 * @param properties - The property metadata of the entity being queried.
 * @returns The branches that can still match something. Empty when none of them can.
 * @throws A BadRequestError when a negation names a value the property cannot hold.
 */
export function dropImpossibleConditions<T extends BaseEntity>(
    branches: WhereFilter<T>[],
    properties: Record<string, PropertyMetadata>
): WhereFilter<T>[] {
    return narrowBranches(branches, properties, '');
}

/**
 * Narrows every branch of a filter, at the given depth of it.
 * @param branches - The branches to narrow.
 * @param properties - The property metadata of the entity the branches filter.
 * @param path - Where in the caller's filter these branches sit, for a refusal to name.
 * @returns The branches that can still match something.
 */
function narrowBranches<T extends BaseEntity>(
    branches: WhereFilter<T>[],
    properties: Record<string, PropertyMetadata>,
    path: string
): WhereFilter<T>[] {
    const res: WhereFilter<T>[] = [];

    for (const branch of branches) {
        const narrowed: WhereFilter<T> | typeof IMPOSSIBLE = narrowBranch(branch, properties, path);
        if (narrowed !== IMPOSSIBLE) {
            res.push(narrowed);
        }
    }

    return res;
}

/**
 * Narrows every condition in a single branch.
 * @param branch - The branch to narrow.
 * @param properties - The property metadata of the entity being queried.
 * @param path - Where in the caller's filter this branch sits.
 * @returns The narrowed branch, or the marker that nothing satisfies it.
 */
function narrowBranch<T extends BaseEntity>(
    branch: WhereFilter<T>,
    properties: Record<string, PropertyMetadata>,
    path: string
): WhereFilter<T> | typeof IMPOSSIBLE {
    const res: Record<string, unknown> = { ...branch };

    for (const [property, condition] of Object.entries(res)) {
        if (condition === undefined) {
            continue;
        }
        const metadata: PropertyMetadata | undefined = properties[property];
        const propertyPath: string = `${path}${property}`;
        const narrowed: unknown | typeof IMPOSSIBLE = narrowPropertyCondition(condition, metadata, propertyPath);
        if (narrowed === IMPOSSIBLE) {
            return IMPOSSIBLE;
        }
        res[property] = narrowed;
    }

    return res as WhereFilter<T>;
}

/**
 * Narrows what one branch asks of one property, by what kind of property it is.
 * @param condition - The condition on the property.
 * @param metadata - The property's metadata, if the entity declares it.
 * @param path - The property's place in the caller's filter.
 * @returns The narrowed condition, or the marker that nothing satisfies it.
 */
function narrowPropertyCondition(condition: unknown, metadata: PropertyMetadata | undefined, path: string): unknown | typeof IMPOSSIBLE {
    if (isToManyRelation(metadata)) {
        return narrowRelationCondition(condition);
    }
    if (isRelationMetadata(metadata)) {
        return narrowToOneRelationCondition(condition, metadata, path);
    }
    return UUIDUtilities.declaresUuidFormat(metadata) ? narrowCondition(condition, path) : condition;
}

/**
 * Narrows what one branch asks of a relation to one entity.
 *
 * The entities it compares against are judged by their id, and a filter on the entity itself by the
 * properties of the target - which is where a uuid column is reached through a join.
 * @param condition - The condition on the relation.
 * @param metadata - The relation's metadata.
 * @param path - The relation's place in the caller's filter.
 * @returns The narrowed condition, or the marker that no row satisfies it.
 */
function narrowToOneRelationCondition(
    condition: unknown,
    metadata: RelationMetadata<BaseEntity>,
    path: string
): unknown | typeof IMPOSSIBLE {
    if (Array.isArray(condition)) {
        // an or of conditions on one property, as on any other
        const possible: unknown[] = condition
            .map(option => narrowToOneRelationCondition(option, metadata, path))
            .filter(option => option !== IMPOSSIBLE);
        return possible.length ? possible : IMPOSSIBLE;
    }
    if (!ScopeWhereUtilities.isConditionObject(condition)) {
        return condition;
    }

    validateNegationsArePossible(condition, isImpossibleEntityId, `${path}.id`);
    const compared: Record<string, unknown> | typeof IMPOSSIBLE = narrowEntityComparisons(condition);
    if (compared === IMPOSSIBLE) {
        return IMPOSSIBLE;
    }
    return narrowRelationWhere(compared, metadata, path);
}

/**
 * Narrows the entities a condition on a relation to one entity compares against, by their ids.
 * @param condition - The condition on the relation.
 * @returns A copy with every id in lower case, or the marker that no row satisfies it.
 */
function narrowEntityComparisons(condition: Record<string, unknown>): Record<string, unknown> | typeof IMPOSSIBLE {
    if (isImpossibleEntityId(condition['is'])) {
        return IMPOSSIBLE;
    }
    const res: Record<string, unknown> = { ...condition };
    for (const key of ['is', 'not']) {
        if (key in res) {
            res[key] = canonicalEntityId(res[key]);
        }
    }
    if (Array.isArray(res['notOneOf'])) {
        res['notOneOf'] = res['notOneOf'].map(e => canonicalEntityId(e));
    }
    if (!Array.isArray(res['oneOf'])) {
        return res;
    }
    const possible: unknown[] = res['oneOf'].filter(e => !isImpossibleEntityId(e));
    return possible.length ? { ...res, oneOf: possible.map(e => canonicalEntityId(e)) } : IMPOSSIBLE;
}

/**
 * Narrows a filter on the entity a relation to one entity holds, by that entity's properties.
 * @param condition - The condition on the relation.
 * @param metadata - The relation's metadata.
 * @param path - The relation's place in the caller's filter.
 * @returns The condition with its `where` narrowed, or the marker that no row satisfies it.
 */
function narrowRelationWhere(
    condition: Record<string, unknown>,
    metadata: RelationMetadata<BaseEntity>,
    path: string
): Record<string, unknown> | typeof IMPOSSIBLE {
    const where: unknown = condition['where'];
    const written: unknown[] = Array.isArray(where) ? where : [where];
    if (where == undefined || !written.every(b => isBranch(b))) {
        return condition;
    }
    const branches: WhereFilter<BaseEntity>[] = narrowBranches(
        written.filter(b => isBranch(b)),
        MetadataUtilities.getModelProperties(metadata.target()),
        `${path}.`
    );
    if (!branches.length) {
        return IMPOSSIBLE;
    }
    return { ...condition, where: Array.isArray(where) ? branches : branches[0] };
}

/**
 * Whether the given value is one branch of a filter, as a `where` on a relation holds.
 * @param value - The value to check.
 * @returns True when it is an object of conditions.
 */
function isBranch(value: unknown): value is WhereFilter<BaseEntity> {
    return typeof value === 'object' && value != undefined && !Array.isArray(value);
}

/**
 * Refuses a negation of a value no row can hold.
 *
 * Every row differs from such a value, so the only answers are every row - a filter that got wider
 * than it reads - or the store refusing the value. Neither is what was asked, and the caller is the
 * one who can say what was meant.
 * @param condition - The condition object holding the negations.
 * @param isImpossible - Whether a value of this kind is one no row can hold.
 * @param path - Where in the caller's filter the negation sits.
 * @throws A BadRequestError when `not` or an entry of `notOneOf` names a value no row can hold.
 */
function validateNegationsArePossible(
    condition: Record<string, unknown>,
    isImpossible: (value: unknown) => boolean,
    path: string
): void {
    const notOneOf: unknown = condition['notOneOf'];
    const negated: unknown[] = Array.isArray(notOneOf) ? notOneOf.map((v: unknown) => v) : [];
    if ('not' in condition) {
        negated.push(condition['not']);
    }
    if (negated.some(v => isImpossible(v))) {
        throw new BadRequestError($ts`The filter on "${path}" excludes a value it cannot hold.`);
    }
}

/**
 * Narrows what one branch asks of a relation, by the ids of the entities it names.
 *
 * The entities are judged by their id rather than by the target's metadata, because every entity
 * extends BaseEntity and its id is always a uuid.
 * @param condition - The condition on the relation.
 * @returns The narrowed condition, or the marker that no row satisfies it.
 */
function narrowRelationCondition(condition: unknown): unknown | typeof IMPOSSIBLE {
    if (!ScopeWhereUtilities.isConditionObject(condition)) {
        return condition;
    }

    // includes asks for a relation holding all of them, so one entity that no row can be is a
    // requirement nothing satisfies
    if (Array.isArray(condition['includes']) && condition['includes'].some(e => isImpossibleEntityId(e))) {
        return IMPOSSIBLE;
    }
    const res: Record<string, unknown> = { ...condition };
    for (const key of ['includes', 'isIncludedIn']) {
        const entities: unknown = res[key];
        if (Array.isArray(entities)) {
            res[key] = entities.map(e => canonicalEntityId(e));
        }
    }

    if (!Array.isArray(res['isIncludedIn'])) {
        return res;
    }
    const possible: unknown[] = res['isIncludedIn'].filter(e => !isImpossibleEntityId(e));
    // an allow list is only narrowed while something is left to allow. Emptying it would say "no
    // related row is permitted", which is not what an empty list is currently answered with, and
    // narrowing must never be the thing that changes an answer
    if (!possible.length) {
        return res;
    }
    return { ...res, isIncludedIn: possible };
}

/**
 * The given entity with its id in lower case, the form it is stored in.
 * @param entity - The entity a relation filter names.
 * @returns A copy when the id changed, otherwise the entity as it is.
 */
function canonicalEntityId(entity: unknown): unknown {
    if (typeof entity !== 'object' || entity == undefined || !('id' in entity)) {
        return entity;
    }
    const id: unknown = UUIDUtilities.resolveCanonical(entity.id);
    return id === entity.id ? entity : { ...entity, id };
}

/**
 * Whether the given entity carries an id no stored row could have.
 * @param entity - The entity a relation filter names.
 * @returns True if no row could be that entity, false if one might.
 */
function isImpossibleEntityId(entity: unknown): boolean {
    if (typeof entity !== 'object' || entity == undefined || !('id' in entity)) {
        return false;
    }
    return isImpossibleValue(entity.id);
}

/**
 * Whether the given property is a relation to many entities, which a filter names as a list.
 * @param property - The metadata of the property a condition names, if the entity has one.
 * @returns True when the values of a filter on it are lists of entities.
 */
function isToManyRelation(property: PropertyMetadata | undefined): boolean {
    return property?.type === Relation.ONE_TO_MANY || property?.type === Relation.MANY_TO_MANY;
}

/**
 * Narrows what one branch asks of one uuid property.
 * @param condition - The condition on that property.
 * @param path - The property's place in the caller's filter.
 * @returns The narrowed condition, or the marker that no value satisfies it.
 */
function narrowCondition(condition: unknown, path: string): unknown | typeof IMPOSSIBLE {
    if (ScopeWhereUtilities.isConditionObject(condition)) {
        validateNegationsArePossible(condition, isImpossibleValue, path);
        const res: Record<string, unknown> = canonicalConditionObject(condition);
        // the only key that lists values a row is required to be one of. Every other key asks for
        // something a uuid column answers on its own, or is a negation, refused above when it names
        // a value no row holds
        if (!Array.isArray(res['oneOf'])) {
            return res;
        }
        const possible: unknown[] = res['oneOf'].filter(v => !isImpossibleValue(v));
        if (!possible.length) {
            return IMPOSSIBLE;
        }
        return { ...res, oneOf: possible };
    }

    if (Array.isArray(condition)) {
        // an array of conditions on a single property is an or, so an option nothing can satisfy is
        // simply one fewer option - and a property left with no option at all decides the branch
        const possible: unknown[] = [];
        for (const option of condition) {
            const narrowed: unknown | typeof IMPOSSIBLE = narrowCondition(option, path);
            if (narrowed !== IMPOSSIBLE) {
                possible.push(narrowed);
            }
        }
        if (!possible.length) {
            return IMPOSSIBLE;
        }
        return possible;
    }

    return isImpossibleValue(condition) ? IMPOSSIBLE : UUIDUtilities.resolveCanonical(condition);
}

/**
 * The given condition with every uuid it compares against in lower case, the form it is stored in.
 * @param condition - A condition object on a uuid property.
 * @returns A copy of the condition.
 */
function canonicalConditionObject(condition: Record<string, unknown>): Record<string, unknown> {
    const res: Record<string, unknown> = { ...condition };
    // the keys comparing against a value. A pattern is left as it was written, since a uuid is no
    // text to match against on a store that types it
    for (const key of ['not', 'after', 'before']) {
        if (key in res) {
            res[key] = UUIDUtilities.resolveCanonical(res[key]);
        }
    }
    for (const key of ['oneOf', 'notOneOf']) {
        const values: unknown = res[key];
        if (Array.isArray(values)) {
            res[key] = values.map(v => UUIDUtilities.resolveCanonical(v));
        }
    }
    return res;
}

/**
 * Whether the given value is one a property of the uuid format could not be holding.
 *
 * Only a string is judged. Null is a value the property can hold, and anything else is left to the
 * store to answer rather than decided here on a guess.
 * @param value - The value asked for.
 * @returns True if no row could carry it, false if one might.
 */
function isImpossibleValue(value: unknown): boolean {
    return typeof value === 'string' && !UUIDUtilities.isUuid(value);
}