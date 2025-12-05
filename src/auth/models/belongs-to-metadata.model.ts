import { AuthStrategies } from '../strategies';
import { SkipAuthMetadata } from './skip-auth-metadata.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types';

/**
 * Metadata for the \@Auth.belongsTo decorator.
 */
export type BelongsToMetadata<TargetEntity extends Newable<BaseEntity>> = {
    /**
     * The target entity that needs to be checked to belong to the user.
     */
    targetEntity: TargetEntity,
    /**
     * The key on the target, that defines to which user it belongs.
     */
    targetUserIdKey: keyof InstanceType<TargetEntity>,
    /**
     * The key of the id path parameter in the endpoint.
     */
    targetIdParamKey: string,
    /**
     * The strategies that are allowed for checking whether or not the user has one of the specified roles.
     *
     * If not set, this allows any strategy.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Metadata for the \@Auth.belongsTo.skip decorator.
 */
export type SkipBelongsToMetadata = SkipAuthMetadata;