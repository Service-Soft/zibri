import { BaseEntity } from '../../../entity/base-entity.model';
import { BulkWriteOptions } from './bulk-write-options.model';

/**
 * Options for inserting several rows, or changing the ones that already hold their identities.
 */
export type UpsertAllOptions<T extends BaseEntity> = BulkWriteOptions<T>;