import { FindOneOptions } from './find-one-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntitySelection } from '../../../entity/models/entity-selection.model';

/**
 * Options for finding a single entity by its id.
 *
 * A `where` here is an **additional** condition: it is combined with the id, so it narrows whether
 * that row counts.
 */
export type FindByIdOptions<
    T extends BaseEntity,
    Required extends boolean = true,
    S extends EntitySelection<T> | undefined = undefined
> = FindOneOptions<T, Required, S>;