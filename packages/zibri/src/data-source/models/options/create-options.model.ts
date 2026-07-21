import { BaseRepositoryOptions } from './base-repository-options.model';

/**
 * Options for creating a single entity.
 */
export type CreateOptions = BaseRepositoryOptions & {
    /**
     * Whether or not setting the id property manually is allowed.
     * @default false.
     */
    allowId?: boolean
};