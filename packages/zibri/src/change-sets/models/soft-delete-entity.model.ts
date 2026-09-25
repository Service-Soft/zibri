import { ChangeSetEntity } from './change-set-entity.model';
import { Property } from '../../entity/decorators/property.decorator';

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
}