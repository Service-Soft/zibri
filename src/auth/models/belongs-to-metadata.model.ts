import { AuthStrategies } from './auth-strategies.model';
import { BaseEntity } from '../../entity';
import { Newable } from '../../types';

export type BelongsToMetadata<TargetEntity extends Newable<BaseEntity>> = {
    targetEntity: TargetEntity,
    targetUserIdKey: keyof InstanceType<TargetEntity>,
    targetIdParamKey: string,
    allowedStrategies?: AuthStrategies
};

export type SkipBelongsToMetadata = {};