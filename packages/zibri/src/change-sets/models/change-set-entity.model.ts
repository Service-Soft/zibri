import { ChangeSet } from './change-set.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';

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