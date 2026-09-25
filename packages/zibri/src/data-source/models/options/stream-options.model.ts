import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Options for reading every matching entity without holding them all at once.
 *
 * `take` and `skip` are gone because a stream is the whole of what matched - a limit on it is a
 * `findAll`, and asking for one here would be two ways to say the same thing that behave
 * differently.
 *
 * `order` is gone because not every data source can give one. Ordering means comparing all of the
 * rows, and a store that filters in this process would have to hold every one of them to do it -
 * which is the thing a stream exists not to do. So a stream is unordered everywhere rather than
 * ordered on some data sources and refused on others: order what you keep, or use `findAll` with an
 * order and the bound that comes with it.
 */
export type StreamOptions<T extends BaseEntity> = OmitStrict<FindAllOptions<T>, 'take' | 'skip' | 'order'>;