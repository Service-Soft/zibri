
import { FindAllOptions } from './find-all-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';

/**
 * Options for finding entities in paginated form.
 */
export type FindAllPaginatedOptions<T extends BaseEntity> = OmitStrict<
    FindAllOptions<T>, 'skip' | 'take'
>;