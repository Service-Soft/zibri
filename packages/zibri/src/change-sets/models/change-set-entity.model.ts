import { ChangeSet } from './change-set.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * An entity that can be handled by the ChangeSetRepository.
 * Has an uuid id and a relation to all its changeSets.
 */
export class ChangeSetEntity extends BaseEntity {
    /**
     * The change sets of the entity.
     */
    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' })
    changeSets!: ChangeSet[];
}

/**
 * Checks whether the given class is a ChangeSetEntity class.
 * @param cls - The class to check.
 * @returns True if it has a changeSets property of type array.
 */
export function isChangeSetEntityNewable(cls: Newable<unknown>): cls is Newable<ChangeSetEntity> {
    return MetadataUtilities.getModelProperties(cls)['changeSets'] !== undefined;
}