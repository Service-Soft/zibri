import { BaseEntity } from '../entity/base-entity.model';
import { UniqueGroup } from '../entity/models/unique-declaration.model';
import { InternalError } from '../error-handling/internal-error.model';
import { ModelRegistry } from '../global/model-registry/model.registry';
import { Newable } from '../types/newable.type';

/**
 * Resolves the unique group that an upsert identity refers to.
 *
 * Shared by every store, because the rule is part of the contract rather than of any one
 * implementation: an identity that is not declared unique can match more than one row, and an
 * operation that has to pick between them is a read followed by a decision - the thing an upsert
 * exists to avoid. What each store then derives from the group differs (a constraint name on sql, a
 * grant key on valkey), which is why only the resolution lives here.
 *
 * A property declared `unique` is a group of one, so a column that says it is unique can identify a
 * row without being named a second time under the entity's `uniques`.
 * @param entityClass - The entity being upserted.
 * @param identityKeys - The properties the caller identified the row by, in any order.
 * @returns The group, in the order it was declared.
 * @throws When nothing declared covers exactly those properties.
 */
export function uniqueGroupFor<T extends BaseEntity>(entityClass: Newable<T>, identityKeys: string[]): UniqueGroup {
    // from the registry rather than read out of the metadata here: this runs on every upsert, and
    // what it needs was resolved once when the class was first seen
    const declared: UniqueGroup | undefined = ModelRegistry.get(entityClass).keyDescriptor.uniqueGroupCovering(identityKeys);

    if (!declared) {
        throw new InternalError([
            `upsert on "${entityClass.name}" was given the identity (${identityKeys.join(', ')}),`,
            'but the entity declares nothing unique that covers exactly those properties.',
            'Without it the identity does not name at most one row, so the operation would not be',
            'atomic - which is the only reason to call this.'
        ]);
    }
    return declared;
}