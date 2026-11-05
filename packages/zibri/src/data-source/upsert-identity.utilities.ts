import { BaseEntity } from '../entity/base-entity.model';
import { coversEveryRow, UniqueGroup } from '../entity/models/unique-declaration.model';
import { InternalError } from '../error-handling/internal-error.model';
import { ModelRegistry } from '../global/model-registry/model.registry';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { Where } from './models/where/where-filter.model';

// Shared by every store, because which row an upsert's identity refers to is part of the contract
// rather than of any one implementation: a store that answered differently would make the same call
// insert on one and update on the other. What each store then derives from it differs (a constraint
// name on sql, a grant key on valkey), which is why only the resolution lives here.
/**
 * Resolves what an upsert's identity refers to: the unique group it names, the row it conflicts with,
 * and its values in a comparable form.
 */
export class UpsertIdentityUtilities {

    /**
     * Resolves the unique group that an upsert identity refers to.
     *
     * A property declared `unique` is a group of one, so a column that says it is unique can identify a
     * row without being named a second time under the entity's `uniques`.
     * @param entityClass - The entity being upserted.
     * @param identityKeys - The properties the caller identified the row by, in any order.
     * @returns The group, in the order it was declared.
     * @throws When nothing declared covers exactly those properties.
     */
    static resolveUniqueGroup<T extends BaseEntity>(entityClass: Newable<T>, identityKeys: string[]): UniqueGroup {
        // an identity that is not declared unique can match more than one row, and an operation that
        // has to pick between them is a read followed by a decision - the thing an upsert exists to
        // avoid. From the registry rather than read out of the metadata here: this runs on every
        // upsert, and what it needs was resolved once when the class was first seen
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

    /**
     * Resolves the filter naming the row an upsert's identity would conflict with.
     *
     * When the unique group covers only some of the rows, the filter carries the group's own condition
     * beside the identity's values.
     * @param entityClass - The entity being upserted.
     * @param identityKeys - The properties identifying the row.
     * @param row - The row being upserted, holding the values of those properties.
     * @returns The filter matching at most the one row this identity may land on.
     * @throws When the entity declares nothing unique covering exactly the identity's properties.
     */
    static resolveConflictWhere<T extends BaseEntity>(
        entityClass: Newable<T>,
        identityKeys: string[],
        row: DeepPartial<T>
    ): Where<T> {
        const group: UniqueGroup = this.resolveUniqueGroup(entityClass, identityKeys);
        const values: Map<string, unknown> = new Map(Object.entries(row));
        const identity: Record<string, unknown> = {};
        for (const key of identityKeys) {
            identity[key] = values.get(key);
        }
        if (group.where == undefined || coversEveryRow(group.where)) {
            return identity as Where<T>;
        }

        // the identity alone is not the filter when the key covers only some of the rows. A room that
        // a cancelled booking still holds is free as far as a key over the open ones is concerned, so
        // a store looking the identity up without the key's own condition finds a row it must not
        // touch - and then updates it instead of inserting beside it.
        // One branch per branch of the key's own filter, because they are alternatives: a row matching
        // any of them is covered, so the identity has to be paired with each rather than with all. A
        // branch naming a property the identity also names, with another value, matches nothing - which
        // is the right answer, since no row can hold both
        const branches: object[] = Array.isArray(group.where) ? group.where : [group.where];
        const paired: object[] = branches.map(branch => ({ ...identity, ...branch }));
        return (paired.length === 1 ? paired[0] : paired) as Where<T>;
    }

    /**
     * Resolves the values a row holds for an upsert's identity, as one string two rows can be compared by.
     * @param identityKeys - The properties identifying the row.
     * @param row - The row.
     * @returns The values, in the order of the identity.
     */
    static resolveValues(identityKeys: string[], row: object): string {
        const values: Map<string, unknown> = new Map(Object.entries(row));
        return JsonUtilities.stringify(identityKeys.map(key => values.get(key)));
    }
}