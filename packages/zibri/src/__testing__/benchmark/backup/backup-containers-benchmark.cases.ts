import { BackupScenario, resolveBackupScenario } from './backup-benchmark.cases';
import { MeasuredResourceConfig, MeasuredTransportConfig } from './backup-measurement.model';
import { ChangeProfile } from './seeded-table.model';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';

const MIB: number = 1024 * 1024;

/**
 * The sizes each series of the suites with real data sources and remote transports is measured at:
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB`, `10,100` by default.
 */
const sizesInMb: number[] = (process.env['ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB'] ?? '10,100').split(',').map(Number);

/**
 * Measurements that differ in the size of the data alone, one at each size.
 */
export type BackupSeries = {
    /**
     * What the series is called, the end of each of its measurements' names.
     */
    name: string,
    /**
     * The resource a measurement of the given size backs up.
     * @param bytes - The size of its data.
     * @returns The resource.
     */
    resource: (bytes: number) => MeasuredResourceConfig,
    /**
     * Where a measurement stores its backups.
     * @param name - The name of the measurement.
     * @returns The transport.
     */
    transport: (name: string) => MeasuredTransportConfig,
    /**
     * See {@link BackupScenario.comparedWith}.
     */
    comparedWith?: string,
    /**
     * How the data changes between two backups, the daily changes unless given.
     */
    changes?: ChangeProfile
};

/**
 * A name that can be part of a path or a key.
 * @param name - The name of a measurement.
 * @returns The name, with nothing but letters, digits and dashes.
 */
export function resolveSlug(name: string): string {
    return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
}

/**
 * The fs transport of each measurement, in a folder of its own, since each boots an application that
 * would otherwise find the backups of the one before.
 * @param outputFolder - Where the suite may store into.
 * @returns The transport of a measurement, by its name.
 */
export function resolveFsTransport(outputFolder: FsPath): (name: string) => MeasuredTransportConfig {
    return name => ({ kind: 'fs', path: FsUtilities.getPath(outputFolder, resolveSlug(name)) });
}

/**
 * Every measurement of some series, each at every size.
 * @param series - The series.
 * @returns The scenarios, series by series.
 */
export function resolveSeriesScenarios(series: BackupSeries[]): BackupScenario[] {
    return series.flatMap(s => sizesInMb.map(sizeInMb => {
        const name: string = `${sizeInMb} MB ${s.name}`;
        return resolveBackupScenario({
            name,
            series: s.name,
            resources: [s.resource(sizeInMb * MIB)],
            seed: 1,
            transport: s.transport(name),
            comparedWith: s.comparedWith,
            changes: s.changes
        });
    }));
}