import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * A one to many or has one relation: the rows it holds point at the row that owns them, through a
 * foreign key of their own.
 */
export type OwnedRelation = {
    /**
     * The property of the owner that holds the rows.
     */
    key: string,
    /**
     * Whether the property holds one row rather than a list of them.
     */
    holdsOne: boolean,
    /**
     * The entity of the rows.
     */
    target: Newable<BaseEntity>,
    /**
     * The property of the rows that holds the owner's id.
     */
    foreignKey: string,
    /**
     * Whether saving the owner saves the rows given with it.
     */
    cascadesInsert: boolean,
    /**
     * Whether saving the owner writes the properties of a row given with an id, rather than only
     * linking it.
     */
    cascadesUpdate: boolean,
    /**
     * Whether deleting the owner deletes its rows.
     */
    cascadesRemove: boolean,
    /**
     * What happens to a row of an owner that is saved with a value for the relation that leaves the
     * row out: deleted when its foreign key is required, unlinked otherwise.
     */
    leftOut: 'delete' | 'unlink'
};
