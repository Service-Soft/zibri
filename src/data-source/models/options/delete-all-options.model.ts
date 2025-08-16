import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';

/**
 * Options for deleting multiple entities.
 */
export type DeleteAllOptions<T extends BaseEntity> = OmitStrict<FindAllOptions<T>, 'where'>;