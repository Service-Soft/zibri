import { JsonUtilities } from '../../../utilities/json.utilities';
import { BACKUP_MEASUREMENT_CONFIG_ENV, BackupMeasurementConfig } from './backup-measurement.model';

/**
 * Reads the config a measured process was forked with.
 * @returns The config.
 * @throws When there is none, which is everywhere but in a process the backup benchmarks forked.
 */
export function resolveBackupMeasurementConfig(): BackupMeasurementConfig {
    const raw: string | undefined = process.env[BACKUP_MEASUREMENT_CONFIG_ENV];
    if (raw == undefined) {
        throw new Error(`${BACKUP_MEASUREMENT_CONFIG_ENV} is not set: this runs in a process the backup benchmarks fork.`);
    }
    return JsonUtilities.parse<BackupMeasurementConfig>(raw);
}