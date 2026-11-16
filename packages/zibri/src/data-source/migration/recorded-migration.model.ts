import { MigrationEntity } from './migration-entity.model';

/**
 * A migration as a database records it: which one, of which version, and when it ran.
 */
export type RecordedMigration = Pick<MigrationEntity, 'name' | 'version' | 'ranAt'>;