import { KeysetOrderKey } from './keyset-order.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { $ts } from '../../localization/translate.function.ts';
import { BoundedFuzzyLikeFilter, SimilarityBound } from '../models/where/fuzzy-like.model.ts';
import { Where, WhereFilter } from '../models/where/where-filter.model.ts';
import { ScopedWhere, ScopeWhereUtilities } from '../scopes/scope-where.utilities.ts';

/**
 * A value a cursor can carry, which is every ordered property type flattened for transport.
 */
export type CursorValue = string | number | boolean;

/**
 * One property of the order, and where the cursor sits on it.
 */
export type KeysetStep = {
    /**
     * The property being compared.
     */
    key: KeysetOrderKey,
    /**
     * The value the row the cursor names holds for it.
     */
    value: string | number | Date
};

/**
 * The condition object one key of the order contributes to one branch.
 */
type KeysetCondition = Record<string, string | number | Date | BoundedFuzzyLikeFilter>;

/**
 * What one branch of the comparison says about each property.
 */
type KeysetBranch = Record<string, string | number | Date | KeysetCondition>;

/**
 * The value of each ordered property on the given row.
 * @param entity - The row the page ended at.
 * @param keys - The order the page was read in.
 * @returns One value per key, in the same order, flattened for a cursor to carry.
 */
export function keysetValuesOf<T extends BaseEntity>(entity: T, keys: KeysetOrderKey[]): CursorValue[] {
    return keys.map(key => {
        const value: unknown = (entity as Record<string, unknown>)[key.property];
        // a date is carried as the instant it names, so a cursor does not depend on how any store
        // happens to render one
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        // unreachable through the repository, which refuses a nullable property in the order before
        // it reads a row - here so that another caller of this hears about it rather than building
        // a cursor that names nothing
        throw new Error(`Cannot continue a keyset read after ${key.property}, which holds no value on this row.`);
    });
}

/**
 * Turns the values a cursor carried back into the position they name.
 * @param values - The values the cursor carried.
 * @param keys - The order the read is being made in.
 * @returns Each key of the order paired with the value the cursor holds for it.
 * @throws When the cursor holds a different number of values than the order has keys.
 */
export function keysetStepsFor(values: CursorValue[], keys: KeysetOrderKey[]): KeysetStep[] {
    if (values.length !== keys.length) {
        throw new BadRequestError($ts`The cursor does not name a position in this order.`);
    }

    const steps: KeysetStep[] = [];
    for (const [i, value] of values.entries()) {
        const key: KeysetOrderKey | undefined = keys[i];
        // the lengths were just compared, so there is always one - which the type cannot know
        if (key != undefined) {
            steps.push({ key, value: valueFor(key, value) });
        }
    }
    return steps;
}

/**
 * Reads one cursor value back as the type its property holds.
 * @param key - The key the value belongs to.
 * @param value - The value as the cursor carried it.
 * @returns The value, comparable against what the store holds.
 */
function valueFor(key: KeysetOrderKey, value: CursorValue): string | number | Date {
    if (key.type === 'date') {
        return new Date(String(value));
    }
    if (key.type === 'number') {
        return Number(value);
    }
    return String(value);
}

/**
 * The condition that puts one property strictly past where the cursor sits on it.
 * @param step - The key and the value to get past.
 * @returns The condition object for that property.
 */
function pastValue(step: KeysetStep): KeysetCondition {
    if (step.key.similarTo != undefined) {
        return similarityTo(step.key.similarTo, String(step.value), 'lesser');
    }
    // `after`/`before` for the types that read as positions - a date and a string both sort - and
    // `greaterThan`/`lesserThan` for numbers, which is the same comparison under the name that type
    // uses for it
    if (step.key.type === 'number') {
        return step.key.direction === 'ASC' ? { greaterThan: step.value } : { lesserThan: step.value };
    }
    return step.key.direction === 'ASC' ? { after: step.value } : { before: step.value };
}

/**
 * The condition that puts one property level with where the cursor sits on it.
 * @param step - The key and the value to be level with.
 * @returns The value itself, or for an order by similarity the condition of being exactly as similar.
 */
function levelWith(step: KeysetStep): string | number | Date | KeysetCondition {
    return step.key.similarTo == undefined ? step.value : similarityTo(step.key.similarTo, String(step.value), 'equal');
}

/**
 * The condition comparing how similar a property is to a search with how similar the cursor's value is.
 * @param search - The search the order compares with.
 * @param text - The value the row the cursor names holds.
 * @param comparison - Whether to be less similar than that value, or exactly as similar.
 * @returns The condition object for that property.
 */
function similarityTo(search: string, text: string, comparison: SimilarityBound['comparison']): KeysetCondition {
    const fuzzyLike: BoundedFuzzyLikeFilter = { value: search, bound: { text, comparison } };
    return { fuzzyLike };
}

/**
 * Narrows a filter to the rows that come after a cursor in the given order.
 *
 * "After" over several properties is a chain rather than one comparison: a row is past the cursor
 * when its first ordered property is past it, or when that one matches and the second is past it,
 * and so on down to the primary key. That is an OR of branches, and each branch pins every property
 * before its own to the value the cursor holds.
 *
 * The caller's filter has to hold as well, so it is paired with each branch - `(a or b) and (c or d)`
 * is `ac or ad or bc or bd`, the same shape a scope is applied in. Where a branch and the caller both
 * speak about an ordered property, both conditions hold: "before ccc" and "after bbb" is the rows in
 * between, not the rows after bbb.
 * @param where - The caller's filter, already narrowed by the entity's scope.
 * @param steps - Each key of the order, with where the cursor sits on it.
 * @param properties - The property metadata of the entity being read.
 * @returns The filter for the rows after the cursor, or the note that no row can be after it.
 */
export function afterCursorWhere<T extends BaseEntity>(
    where: Where<T> | undefined,
    steps: KeysetStep[],
    properties: Record<string, PropertyMetadata>
): ScopedWhere<T> {
    const keysetBranches: WhereFilter<T>[] = steps.map((step, i) => {
        const branch: KeysetBranch = {};
        for (const earlier of steps.slice(0, i)) {
            branch[earlier.key.property] = levelWith(earlier);
        }
        branch[step.key.property] = pastValue(step);
        return branch as WhereFilter<T>;
    });

    // the merge a scope is applied with, because it is the same question: two filters that both have
    // to hold. A position used to be spread over the caller's branch instead, which replaced the
    // caller's condition on an ordered property and so read on past an upper bound - on every store
    // that reads the window apart from the total
    return ScopeWhereUtilities.applyToWhere(where, keysetBranches, properties);
}