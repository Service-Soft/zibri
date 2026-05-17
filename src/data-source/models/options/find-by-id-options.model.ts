import { FindOneOptions } from './find-one-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Options for finding a single entity by its id.
 */
export type FindByIdOptions<T extends BaseEntity> = OmitStrict<FindOneOptions<T>, 'where'>;