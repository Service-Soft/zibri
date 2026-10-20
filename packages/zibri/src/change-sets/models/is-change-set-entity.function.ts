import { type ChangeSetEntity } from './change-set-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Checks whether the given class is a ChangeSetEntity class.
 *
 * Kept apart from the class it recognizes, and importing it as a type only, so that asking the
 * question costs nothing at load time. `@Entity` asks it, and the change set entities are themselves
 * decorated with `@Entity` - reaching them from there evaluates that module while the decorator's own
 * is still initializing, which leaves whatever loads inside the cycle holding undefined.
 * @param cls - The class to check.
 * @returns True if it has a changeSets property.
 */
export function isChangeSetEntityNewable(cls: Newable<unknown>): cls is Newable<ChangeSetEntity> {
    return MetadataUtilities.getModelProperties(cls)['changeSets'] !== undefined;
}