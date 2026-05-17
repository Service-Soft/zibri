import { BaseRepositoryOptions } from './base-repository-options.model';

/**
 * Options for updating an entity by its id.
 */
export type UpdateByIdOptions = BaseRepositoryOptions & {
    // should never be allowed, as that would cause typeorm's manager.save method to create a new entity instead of updating the existing one.
    // allowId?: boolean
};