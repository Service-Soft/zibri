import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * What every write that hands several rows back takes.
 *
 * The bulk half of {@link WriteRelationsOptions}: the rows a bulk write answers with are the rows
 * finding them would give, resolved in one read for the whole batch rather than one per row.
 */
export type BulkWriteOptions<T extends BaseEntity> = BaseRepositoryOptions & WriteRelationsOptions<T>;