import { EntitySchemaRelationOptions } from 'typeorm';

import { BasePropertyMetadata } from './base-property-metadata.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { type BaseEntity } from '../base-entity.model.ts';

/**
 * Metadata shared by all relation properties.
 */
export type BaseRelationMetadata<T extends BaseEntity> = BasePropertyMetadata
    & Required<Pick<EntitySchemaRelationOptions, 'cascade'>> & {
        /**
         * A function returning the target class,
         * used to avoid circular import issues.
         */
        target: () => Newable<T>,
        /**
         * The name of the inverse property on the target,
         * e.g. 'user' if Posts has `@Property.manyToOne(() => User, 'post')`.
         */
        inverseSide: keyof T
    };