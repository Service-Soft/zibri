import { EntitySchemaRelationOptions } from 'typeorm';

import { BasePropertyMetadata } from './base-property-metadata.model';
import { Newable } from '../../types';
import { BaseEntity } from '../decorators';

/**
 * Metadata shared by all relation properties.
 */
export type BaseRelationMetadata<T extends BaseEntity> = BasePropertyMetadata
    & Required<Pick<EntitySchemaRelationOptions, 'cascade' | 'persistence'>> & {
        /**
         * A function returning the target class,
         * used to avoid circular import issues.
         */
        target: () => Newable<T>,
        /**
         * The name of the inverse property on the target,
         * e.g. 'user' if Posts has `@ManyToOne(() => User, 'post')`.
         */
        inverseSide: keyof T
    };