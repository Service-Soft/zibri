import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for inserting a row or changing the one that already holds the identity.
 */
export type UpsertOptions<T extends BaseEntity> = BaseRepositoryOptions & WriteRelationsOptions<T>;