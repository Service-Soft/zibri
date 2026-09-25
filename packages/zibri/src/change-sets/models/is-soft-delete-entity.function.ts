import { isChangeSetEntityNewable } from './is-change-set-entity.function';
import { type SoftDeleteEntity } from './soft-delete-entity.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Checks whether the given class is a SoftDeleteEntity class.
 *
 * Kept apart from the class it recognizes for the reason given on {@link isChangeSetEntityNewable}.
 * @param cls - The class to check.
 * @returns True if it is a ChangeSetEntity class that also has a deleted property of type boolean.
 */
export function isSoftDeleteEntityNewable(cls: Newable<unknown>): cls is Newable<SoftDeleteEntity> {
    return isChangeSetEntityNewable(cls) && MetadataUtilities.getModelProperties(cls)['deleted']?.type === 'boolean';
}