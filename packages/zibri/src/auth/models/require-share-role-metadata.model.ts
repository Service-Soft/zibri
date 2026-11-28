import { type BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * What `@Auth.requireShareRole` declares: the least role a caller holds on the row a path parameter names.
 */
export type RequireShareRoleMetadata = {
    /**
     * The entity of the row: shareable, or shared through a relation.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The least role, one of those the shareable entity declares.
     */
    role: string,
    /**
     * The path parameter holding the id of the row.
     */
    pathParam: string
};
