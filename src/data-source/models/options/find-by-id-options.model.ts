import { FindOneOptions } from './find-one-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';

/**
 * Options for finding a single entity by its id.
 */
export type FindByIdOptions<T extends BaseEntity> = OmitStrict<FindOneOptions<T>, 'where'>;