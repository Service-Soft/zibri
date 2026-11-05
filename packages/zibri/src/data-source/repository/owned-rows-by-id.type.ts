import { BaseEntity } from '../../entity/base-entity.model';

/**
 * The rows written along with each written row, by its id and then by the key of their relation.
 */
export type OwnedRowsById = Map<string, Map<string, BaseEntity[]>>;