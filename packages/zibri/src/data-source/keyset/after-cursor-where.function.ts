import { KeysetOrderKey } from './keyset-order.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { ScopeWhereUtilities } from '../scopes/scope-where.utilities';

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
type KeysetCondition = Record<string, string | number | Date>;

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
    // `after`/`before` for the types that read as positions - a date and a string both sort - and
    // `greaterThan`/`lesserThan` for numbers, which is the same comparison under the name that type
    // uses for it
    if (step.key.type === 'number') {
        return step.key.direction === 'ASC' ? { greaterThan: step.value } : { lesserThan: step.value };
    }
    return step.key.direction === 'ASC' ? { after: step.value } : { before: step.value };
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
 * speak about an ordered property, the branch's condition replaces the caller's: the row the cursor
 * came from passed that filter, so sitting past it is a narrowing of what the caller asked for rather
 * than a widening of it. That holds only for a cursor issued by this same read, which is what the
 * fingerprint a cursor carries is checked for.
 * @param where - The caller's filter, already narrowed by the entity's scope.
 * @param steps - Each key of the order, with where the cursor sits on it.
 * @returns The filter for the rows after the cursor.
 */
export function afterCursorWhere<T extends BaseEntity>(where: Where<T> | undefined, steps: KeysetStep[]): Where<T> {
    const keysetBranches: KeysetBranch[] = steps.map((step, i) => {
        const branch: KeysetBranch = {};
        for (const earlier of steps.slice(0, i)) {
            branch[earlier.key.property] = earlier.value;
        }
        branch[step.key.property] = pastValue(step);
        return branch;
    });

    const branches: WhereFilter<T>[] = [];
    for (const callerBranch of ScopeWhereUtilities.branchesOf(where)) {
        for (const keysetBranch of keysetBranches) {
            branches.push({ ...callerBranch, ...keysetBranch } as WhereFilter<T>);
        }
    }

    const single: WhereFilter<T> | undefined = branches.length === 1 ? branches[0] : undefined;
    return single ?? branches;
}