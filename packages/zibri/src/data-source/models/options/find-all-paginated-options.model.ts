
import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Options for finding entities in paginated form.
 */
export type FindAllPaginatedOptions<T extends BaseEntity> = OmitStrict<
    FindAllOptions<T>, 'skip' | 'take'
>;