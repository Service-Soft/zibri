import { BaseRepositoryOptions } from './base-repository-options.model';

/**
 * Options for updating multiple entities at once.
 */
export type UpdateAllOptions = BaseRepositoryOptions & {
    // should never be allowed, as that would cause typeorm's manager.save method to create new entities instead of updating the existing ones.
    // allowId?: boolean
};