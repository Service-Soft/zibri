import { BaseEntity } from '../../entity';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { AuthStrategies, BelongsToMetadata } from '../models';

export interface BelongsToFn {
    <T extends Newable<BaseEntity>>(
        targetEntity: T,
        targetIdParamKey?: string,
        targetUserIdKey?: keyof InstanceType<T>,
        allowedStrategies?: AuthStrategies
    ): MethodDecorator & ClassDecorator,
    skip: () => MethodDecorator & ClassDecorator
}

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