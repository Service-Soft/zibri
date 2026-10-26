import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Options for finding entities in paginated form.
 */
export type FindAllPaginatedOptions<T extends BaseEntity, S extends EntitySelection<T> | undefined = undefined> = OmitStrict<
    FindAllOptions<T, S>, 'offset' | 'limit'
>;