import { Where } from './models/where/where-filter.model';
import { uniqueGroupFor } from './unique-group-for.function';
import { BaseEntity } from '../entity/base-entity.model';
import { coversEveryRow, UniqueGroup } from '../entity/models/unique-declaration.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';

/**
 * The filter naming the row an upsert's identity would conflict with.
 *
 * Shared by every store for the reason {@link uniqueGroupFor} is: which row an identity refers to is
 * part of the contract rather than of any one implementation, and a store that answered differently
 * would make the same call insert on one and update on the other.
 *
 * The identity alone is not that filter when the key covers only some of the rows. A room that a
 * cancelled booking still holds is free as far as a key over the open ones is concerned, so a store
 * looking the identity up without the key's own condition finds a row it must not touch - and then
 * updates it instead of inserting beside it.
 * @param entityClass - The entity being upserted.
 * @param identity - The properties identifying the row, and their values.
 * @returns The filter matching at most the one row this identity may land on.
 * @throws When the entity declares nothing unique covering exactly the identity's properties.
 */
export function upsertConflictWhere<T extends BaseEntity>(entityClass: Newable<T>, identity: DeepPartial<T>): Where<T> {
    const group: UniqueGroup = uniqueGroupFor(entityClass, Object.keys(identity));
    if (group.where == undefined || coversEveryRow(group.where)) {
        return identity as Where<T>;
    }

    // one branch per branch of the key's own filter, because they are alternatives: a row matching
    // any of them is covered, so the identity has to be paired with each rather than with all. A
    // branch naming a property the identity also names, with another value, matches nothing - which
    // is the right answer, since no row can hold both
    const branches: object[] = Array.isArray(group.where) ? group.where : [group.where];
    const paired: object[] = branches.map(branch => ({ ...identity, ...branch }));
    return (paired.length === 1 ? paired[0] : paired) as Where<T>;
}