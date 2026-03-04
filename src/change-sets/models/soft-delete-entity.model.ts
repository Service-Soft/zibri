import { ChangeSetEntity, isChangeSetEntityNewable } from './change-set-entity.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * An entity that can be handled by the SoftDeleteRepository.
 * Has an uuid id, a relation to all its changeSets and a flag that determines whether it is "soft deleted" or not.
 */
export type SoftDeleteEntity = ChangeSetEntity & {
    /**
     * Whether or not the entity is soft deleted.
     */
    deleted: boolean
};

/**
 * Checks whether the given class is a SoftDeleteEntity class.
 * @param cls - The class to check.
 * @returns True if it is a ChangeSetEntity class and also has a deleted property of type boolean.
 */
export function isSoftDeleteEntityNewable(cls: Newable<unknown>): cls is Newable<SoftDeleteEntity> {
    return isChangeSetEntityNewable(cls) && MetadataUtilities.getModelProperties(cls)['deleted']?.type === 'boolean';
}