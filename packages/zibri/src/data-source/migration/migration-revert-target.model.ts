import { SemVerVersion } from '../../utilities/sem-ver.utilities';

/**
 * Where reverting migrations stops.
 */
export type MigrationRevertTarget = {
    /**
     * Every applied migration of a newer version is reverted.
     */
    version: SemVerVersion
} | {
    /**
     * Every migration applied after the one of this name is reverted. The one of this name stays.
     */
    migrationName: string
} | {
    /**
     * Every applied migration is reverted.
     */
    all: true
};