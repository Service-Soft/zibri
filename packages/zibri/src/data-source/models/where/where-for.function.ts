import { Where } from './where-filter.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { KeyWhere } from '../../../entity/models/unique-declaration.model';

/**
 * Types a filter against the entity it is declared on.
 *
 * A property decorator is handed its options before it is handed the class it ended up on, so a
 * filter written beside one cannot be checked against that entity unless the entity is named. Saying
 * it here is what turns a mistyped column into a compile error instead of a boot failure.
 * @param where - The filter, checked against `T`.
 * @returns The same filter, marked as typed.
 */
export function whereFor<T extends BaseEntity>(where: Where<T>): KeyWhere {
    // the one cast that may produce a KeyWhere. The mark says the entity was named, and this is the
    // only place that can know it was
    return where as KeyWhere;
}