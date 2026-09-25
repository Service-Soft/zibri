import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Relation } from '../../entity/models/relation.enum';
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
 * an equality, or one option out of a list of them. Negations are left exactly as they are, because
 * a value a column cannot hold is one that every row differs from, and acting on that would widen the
 * filter rather than narrow it - the one direction a mistake here must never take.
 *
 * A relation is judged by the ids of the entities a filter on it names, under the same rule.
 * @param branches - The filter to narrow, as the branches it is an OR of.
 * @param properties - The property metadata of the entity being queried.
 * @returns The branches that can still match something. Empty when none of them can.
 */
export function dropImpossibleConditions<T extends BaseEntity>(
    branches: WhereFilter<T>[],
    properties: Record<string, PropertyMetadata>
): WhereFilter<T>[] {
    const res: WhereFilter<T>[] = [];

    for (const branch of branches) {
        const narrowed: WhereFilter<T> | typeof IMPOSSIBLE = narrowBranch(branch, properties);
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
 * @returns The narrowed branch, or the marker that nothing satisfies it.
 */
function narrowBranch<T extends BaseEntity>(
    branch: WhereFilter<T>,
    properties: Record<string, PropertyMetadata>
): WhereFilter<T> | typeof IMPOSSIBLE {
    const res: Record<string, unknown> = { ...branch };

    for (const [property, condition] of Object.entries(res)) {
        if (condition === undefined) {
            continue;
        }
        const metadata: PropertyMetadata | undefined = properties[property];
        const narrowed: unknown | typeof IMPOSSIBLE = isRelation(metadata)
            ? narrowRelationCondition(condition)
            : declaresUuidFormat(metadata) ? narrowCondition(condition) : condition;
        if (narrowed === IMPOSSIBLE) {
            return IMPOSSIBLE;
        }
        res[property] = narrowed;
    }

    return res as WhereFilter<T>;
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

    if (!Array.isArray(condition['isIncludedIn'])) {
        return condition;
    }
    const possible: unknown[] = condition['isIncludedIn'].filter(e => !isImpossibleEntityId(e));
    // an allow list is only narrowed while something is left to allow. Emptying it would say "no
    // related row is permitted", which is not what an empty list is currently answered with, and
    // narrowing must never be the thing that changes an answer
    if (!possible.length) {
        return condition;
    }
    return { ...condition, isIncludedIn: possible };
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
 * Whether the given property is a relation naming entities rather than holding values.
 * @param property - The metadata of the property a condition names, if the entity has one.
 * @returns True when the values of a filter on it are entities.
 */
function isRelation(property: PropertyMetadata | undefined): boolean {
    return property?.type === Relation.ONE_TO_MANY || property?.type === Relation.MANY_TO_MANY;
}

/**
 * Narrows what one branch asks of one uuid property.
 * @param condition - The condition on that property.
 * @returns The narrowed condition, or the marker that no value satisfies it.
 */
function narrowCondition(condition: unknown): unknown | typeof IMPOSSIBLE {
    if (ScopeWhereUtilities.isConditionObject(condition)) {
        // the only key that lists values a row is required to be one of. Every other key either
        // asks for something a uuid column answers on its own, or is a negation, which stays put
        if (!Array.isArray(condition['oneOf'])) {
            return condition;
        }
        const possible: unknown[] = condition['oneOf'].filter(v => !isImpossibleValue(v));
        if (!possible.length) {
            return IMPOSSIBLE;
        }
        return { ...condition, oneOf: possible };
    }

    if (Array.isArray(condition)) {
        // an array of conditions on a single property is an or, so an option nothing can satisfy is
        // simply one fewer option - and a property left with no option at all decides the branch
        const possible: unknown[] = [];
        for (const option of condition) {
            const narrowed: unknown | typeof IMPOSSIBLE = narrowCondition(option);
            if (narrowed !== IMPOSSIBLE) {
                possible.push(narrowed);
            }
        }
        if (!possible.length) {
            return IMPOSSIBLE;
        }
        return possible;
    }

    return isImpossibleValue(condition) ? IMPOSSIBLE : condition;
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

/**
 * Whether the given property declares the uuid format.
 *
 * Exported because a write has to hold the same rule a read narrows by: this decides both that a
 * value outside the format names no row, and that storing one would be a lie.
 * @param property - The metadata of the property a condition names, if the entity has one.
 * @returns True when every value it can hold is a uuid.
 */
export function declaresUuidFormat(property: PropertyMetadata | undefined): boolean {
    return property?.type === 'string' && property.format === 'uuid';
}