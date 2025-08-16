
import { ChangeSet } from './change-set.model';
import { BaseEntity } from '../../entity';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';

/**
 * An entity that can be handled by the ChangeSetRepository.
 * Has an uuid id and a relation to all its changeSets.
 */
export type ChangeSetEntity = BaseEntity & {
    /**
     * The change sets of the entity.
     */
    changeSets: ChangeSet[]
};

/**
 * Checks whether the given class is a ChangeSetEntity class.
 * @param cls - The class to check.
 * @returns True if it has a changeSets property of type array.
 */
export function isChangeSetEntityNewable(cls: Newable<unknown>): cls is Newable<ChangeSetEntity> {
    return MetadataUtilities.getModelProperties(cls)['changeSets']?.type === 'array';
}