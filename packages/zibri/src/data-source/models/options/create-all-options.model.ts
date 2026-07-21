import { BaseRepositoryOptions } from './base-repository-options.model';

/**
 * Options for creating multiple entities.
 */
export type CreateAllOptions = BaseRepositoryOptions & {
    /**
     * Whether or not setting the id property manually is allowed.
     * @default false.
     */
    allowId?: boolean
};