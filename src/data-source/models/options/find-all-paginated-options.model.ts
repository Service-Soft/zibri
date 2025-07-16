
import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';

/**
 * Options for finding entities in paginated form.
 */
export type FindAllPaginatedOptions<T extends BaseEntity> = OmitStrict<
    FindAllOptions<T>, 'skip' | 'take'
>;