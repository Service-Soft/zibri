import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity';

/**
 * Options for deleting multiple entities.
 */
export type DeleteAllOptions<T extends BaseEntity> = FindAllOptions<T>;