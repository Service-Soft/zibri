import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Options for reading every matching entity without holding them all at once.
 *
 * `limit` and `offset` are gone because a stream is the whole of what matched - a limit on it is a
 * `findAll`, and asking for one here would be two ways to say the same thing that behave
 * differently.
 *
 * `order` hands the rows out in that order. Without one they come in no particular order, and the
 * entity's `defaultOrder` does not apply: ordering what a stream reads costs a data source more than
 * reading it.
 */
export type StreamOptions<T extends BaseEntity, S extends EntitySelection<T> | undefined = undefined> = OmitStrict<
    FindAllOptions<T, S>, 'limit' | 'offset'
>;