import { BaseRepositoryOptions } from './base-repository-options.model';

/**
 * Options for updating multiple entities at once.
 */
export type UpdateAllOptions = BaseRepositoryOptions & {
    /**
     * Whether or not setting the id property manually is allowed.
     * @default false.
     */
    allowId?: boolean
};