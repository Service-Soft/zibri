import { BaseEntity } from '../entity/base-entity.model';
import { InternalError } from '../error-handling/internal-error.model';
import { ModelRegistry } from '../global/model-registry/model.registry';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { Where, WhereFilter } from './models/where/where-filter.model';
import { ScopeWhereUtilities } from './scopes/scope-where.utilities';

/**
 * Refuses a write that would silently overwrite a property declaring `optimisticLocking`.
 *
 * Last write wins is the default everywhere and is right for most properties. It is wrong for the
 * ones two people edit at once: both read, both write, the second one lands and neither is told that
 * the first ever happened. What the second write has to prove is that the value it acted on is still
 * there, and only the caller can supply it - by the time the update arrives, reading the property
 * returns the value including the other write.
 *
 * So the declaration cannot fill the condition in, only insist that there is one. The property is
 * named in the filter or the write is refused, which is what makes it impossible for one endpoint to
 * be the one that forgot.
 *
 * Every branch has to name it: a filter that is an OR of several is only as locked as its weakest
 * branch, and one branch without the condition is one path on which the write lands blindly.
 * @param entityClass - The entity being written to.
 * @param data - The change about to be written.
 * @param where - The filter the caller gave, which is where the expected values live.
 * @throws When the change names an optimistically locked property that the filter does not.
 */
export function validateWriteIsNotBlind<T extends BaseEntity>(
    entityClass: Newable<T>,
    data: DeepPartial<T>,
    where: Where<T> | undefined
): void {
    const locked: Set<string> = ModelRegistry.get(entityClass).optimisticLockDescriptor.keys;
    if (!locked.size) {
        return;
    }

    const branches: WhereFilter<T>[] = ScopeWhereUtilities.branchesOf(where);
    for (const key of Object.keys(data)) {
        // `in` rather than a value check, because naming the property with no condition is how a
        // caller says it means to overwrite whatever is there. An import or an administrative fix
        // has nothing to compare against and is not the same as having forgotten to
        if (!locked.has(key) || branches.every(b => key in b)) {
            continue;
        }
        throw new InternalError(
            `${entityClass.name}.${key} declares optimistic locking, so writing it has to say what it was:`
            + ` pass { where: { ${key}: <the value you read> } } and the write lands only if nobody`
            + ` changed it in between. Pass { where: { ${key}: undefined } } to overwrite it regardless.`
        );
    }
}