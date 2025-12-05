import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { BelongsToMetadata } from '../models';
import { AuthStrategies } from '../strategies';

/**
 * The type of the belongs to decorator.
 */
export interface BelongsToFn {
    <T extends Newable<BaseEntity>>(
        targetEntity: T,
        targetIdParamKey?: string,
        targetUserIdKey?: keyof InstanceType<T>,
        allowedStrategies?: AuthStrategies
    ): MethodDecorator & ClassDecorator,
    /**
     * This skips the belongs to validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when the logged in user belongs to the requested resource somehow.
 * @param targetEntity - The target entity that needs to be checked to belong to the user.
 * @param targetIdParamKey - The key of the id path parameter in the endpoint.
 * @param targetUserIdKey - The key on the target, that defines to which user it belongs.
 * @param allowedStrategies - The auth strategies that are allowed to be used to check that.
 */
export const belongsToDecorator: BelongsToFn = (
    <T extends Newable<BaseEntity>>(
        targetEntity: T,
        targetIdParamKey: string = 'id',
        targetUserIdKey: keyof InstanceType<T> = 'userId' as keyof InstanceType<T>,
        allowedStrategies?: AuthStrategies
    ) => {
        const fullMetadata: BelongsToMetadata<T> = {
            targetEntity,
            allowedStrategies,
            targetUserIdKey,
            targetIdParamKey
        };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteBelongsTo(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerBelongsTo(target as Function, fullMetadata);
            }
        };
        return decorator;
    }
) as BelongsToFn;

belongsToDecorator.skip = () => ((
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipBelongsTo(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipBelongsTo(target as Function, {});
    }
}) as MethodDecorator & ClassDecorator;