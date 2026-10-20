import { FindOneOptions } from './find-one-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';

/**
 * Options for finding a single entity by its id.
 *
 * A `where` here is an **additional** condition rather than a replacement: it is combined with the
 * id, so it narrows whether that row counts instead of naming a different one.
 */
export type FindByIdOptions<T extends BaseEntity, Required extends boolean = true> = FindOneOptions<T, Required>;