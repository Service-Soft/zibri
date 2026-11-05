import { Property } from './decorators/property.decorator';

/**
 * The base entity that all db entities need to extend from.
 */
export class BaseEntity {
    /**
     * The uuid (universal unique identifier) of the entity.
     */
    @Property.string({ primary: true })
    id!: string;
}