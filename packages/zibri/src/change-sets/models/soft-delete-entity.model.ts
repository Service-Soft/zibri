import { ChangeSetEntity } from './change-set-entity.model.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * An entity that can be handled by the SoftDeleteRepository.
 * Has an uuid id, a relation to all its changeSets and a flag that determines whether it is "soft deleted" or not.
 */
export class SoftDeleteEntity extends ChangeSetEntity {
    /**
     * Whether or not the entity is soft deleted.
     */
    @Property.boolean({ default: false })
    deleted!: boolean;

    /**
     * The id of the row whose soft delete took this one along, which restoring that row restores it
     * with. Null when the row is not deleted, or was deleted on its own.
     */
    // a key of its own rather than optional, so that an entity implementing this rather than extending
    // it is told to declare it - the soft delete writes it on every row it marks
    @Property.string({ required: false })
    deletedWith: string | null | undefined;
}