import { type BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { RequireShareRoleMetadata } from '../models/require-share-role-metadata.model';

/**
 * The type of the require share role decorator.
 */
export type RequireShareRoleFn = (entityClass: Newable<BaseEntity>, role: string, pathParam: string) => MethodDecorator & ClassDecorator;

/**
 * Marks an endpoint to be only reachable when the caller sees every row of the entity through its `fullAccess`, or
 * holds at least the role on the row the path parameter names, or on a row above it.
 * @param entityClass - The entity of the row: shareable, or shared through a relation.
 * @param role - The least role, one of those the shareable entity declares.
 * @param pathParam - The path parameter holding the id of the row.
 * @returns The decorator, usable on a route or on a controller.
 */
export const requireShareRoleDecorator: RequireShareRoleFn = (entityClass, role, pathParam) => {
    const fullMetadata: RequireShareRoleMetadata = { entityClass, role, pathParam };
    return (target: Object, propertyKey?: string | symbol) => {
        if (propertyKey !== undefined) {
            MetadataUtilities.setRouteRequireShareRole(target.constructor, fullMetadata, propertyKey as string);
        }
        else {
            MetadataUtilities.setControllerRequireShareRole(target as Function, fullMetadata);
        }
    };
};