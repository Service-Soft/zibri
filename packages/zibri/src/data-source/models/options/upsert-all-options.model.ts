import { BulkWriteOptions } from './bulk-write-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';

/**
 * Options for inserting several rows, or changing the ones that already hold their identities.
 */
export type UpsertAllOptions<T extends BaseEntity> = BulkWriteOptions<T>;