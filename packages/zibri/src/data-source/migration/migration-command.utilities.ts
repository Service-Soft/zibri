import { EntitySnapshotUtilities } from './entity-snapshot.utilities';
import { MigrationEntity } from './migration-entity.model';
import { MigrationGenerationRequest, MigrationGenerationResponse } from './migration-generation.model';
import { GeneratedMigration, MigrationGeneratorUtilities } from './migration-generator.utilities';
import { MigrationRevertTarget } from './migration-revert-target.model';
import { resolveMigrationRepository } from './run-migrations.function';
import { DiContainer } from '../../di/di-container';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { SemVerUtilities, SemVerVersion } from '../../utilities/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';

/**
 * A command of the application about its migrations.
 */
export type MigrationCommand = {
    /**
     * Lists the migrations every data source has applied.
     */
    action: 'list'
} | {
    /**
     * Reverts the migrations applied after a version or a migration.
     */
    action: 'down',
    /**
     * Where reverting stops.
     */
    target: MigrationRevertTarget
} | {
    /**
     * Writes the migrations of the entities that changed, for `zi migrate create`, or the snapshots
     * they start from, for `zi migrate baseline`.
     */
    action: 'generate',
    /**
     * The file `zi migrate create` wrote what it asks for into.
     */
    requestFile: string,
    /**
     * The file the migrations are written into, for `zi migrate create` to put in place.
     */
    responseFile: string
};

/**
 * A migration written for one data source, with the snapshot to commit with it.
 */
type GeneratedDataSourceMigration = MigrationGenerationResponse['migrations'][number];

/**
 * How the migration commands are written, for the message refusing one that is not.
 */
const USAGE: string[] = [
    'migrate list                              lists the migrations every data source has applied',
    'migrate down <version | migration name>   reverts every migration applied after it, newest first',
    'migrate down --all                        reverts every applied migration, newest first'
];

/**
 * Reads and runs the commands of an application about its migrations.
 */
export abstract class MigrationCommandUtilities {
    /**
     * Resolves which migration command the given arguments name.
     * @param args - The arguments the process was started with, after the script.
     * @returns The command, or undefined when the arguments do not start with `migrate`.
     * @throws When they start with `migrate`, and name no command of it.
     */
    static resolveCommand(args: string[]): MigrationCommand | undefined {
        const [name, action, target, ...rest] = args;
        if (name !== 'migrate') {
            return undefined;
        }
        if (action === 'list' && target == undefined) {
            return { action: 'list' };
        }
        if (action === 'down' && target != undefined && !rest.length) {
            return { action: 'down', target: this.resolveRevertTarget(target) };
        }
        // run by `zi migrate create` rather than by hand, so not among the commands the usage lists
        const [responseFile, ...more] = rest;
        if (action === 'generate' && target != undefined && responseFile != undefined && !more.length) {
            return { action: 'generate', requestFile: target, responseFile };
        }
        throw new InternalError([`"${args.join(' ')}" is no migration command. The migration commands are:`, ...USAGE]);
    }

    /**
     * Runs a migration command against the data sources of an initialized application.
     * @param command - The command.
     * @param dataSourceClasses - The data sources of the application.
     * @param logger - Where what the command finds is written.
     * @throws When `down` names a migration no data source has recorded, or reverting fails.
     */
    static async run(command: MigrationCommand, dataSourceClasses: Newable<DataSourceInterface>[], logger: LoggerInterface): Promise<void> {
        switch (command.action) {
            case 'list': {
                await this.list(dataSourceClasses, logger);
                return;
            }
            case 'down': {
                await this.down(command.target, dataSourceClasses);
                return;
            }
            case 'generate': {
                await this.generate(command, dataSourceClasses);
                return;
            }
        }
    }

    /**
     * Writes the migrations of every data source whose entities changed since its snapshot, and the
     * snapshots to commit with them, for `zi migrate create` to put in place.
     *
     * Needs the container filled and nothing more: the data sources are built, not connected.
     * @param command - The command, naming the files to read from and write to.
     * @param dataSourceClasses - The data sources of the application.
     * @throws When the request is not one, names no file for a data source, or nothing changed.
     */
    static async generate(
        command: Extract<MigrationCommand, Record<'action', 'generate'>>,
        dataSourceClasses: Newable<DataSourceInterface>[]
    ): Promise<void> {
        const request: unknown = JsonUtilities.parse(await FsUtilities.readFile(FsUtilities.getPath(command.requestFile)));
        if (!this.isGenerationRequest(request)) {
            throw new InternalError(`"${command.requestFile}" holds no request to generate migrations.`);
        }
        if (request.baseline === true) {
            await this.writeBaselines(request, dataSourceClasses, command.responseFile);
            return;
        }
        const version: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
        if (version == undefined) {
            throw new InternalError('Cannot generate migrations: no app version could be resolved.');
        }
        const generated: MigrationGenerationResponse['migrations'] = [];
        for (const dataSourceClass of dataSourceClasses) {
            if (request.emptyFor != undefined && request.emptyFor !== dataSourceClass.name) {
                continue;
            }
            const migration: GeneratedDataSourceMigration | undefined
                = await this.generateForDataSource(request, dataSourceClass, dataSourceClasses, version);
            if (migration != undefined) {
                generated.push(migration);
            }
        }
        if (!generated.length) {
            throw new InternalError([
                'Nothing the entities declare changed since the last migration, so there is no migration to write.',
                'To write one of your own, such as one cleaning up data, use --empty.'
            ]);
        }
        const response: MigrationGenerationResponse = { migrations: generated };
        await FsUtilities.upsertFile(FsUtilities.getPath(command.responseFile), JsonUtilities.stringify(response));
    }

    /**
     * Generates the migration of one data source, when its entities changed since its snapshot or an
     * empty one is asked for.
     * @param request - What `zi migrate create` asked for.
     * @param dataSourceClass - The data source.
     * @param dataSourceClasses - The data sources of the application.
     * @param version - The version of the application.
     * @returns The migration with the snapshot to commit with it, or undefined when nothing changed.
     * @throws When the request names no file for the data source.
     */
    private static async generateForDataSource(
        request: MigrationGenerationRequest,
        dataSourceClass: Newable<DataSourceInterface>,
        dataSourceClasses: Newable<DataSourceInterface>[],
        version: SemVerVersion
    ): Promise<GeneratedDataSourceMigration | undefined> {
        const asked: MigrationGenerationRequest['dataSources'][string] | undefined = request.dataSources[dataSourceClass.name];
        if (asked == undefined) {
            throw new InternalError(`No file of the project declares the data source "${dataSourceClass.name}" with @DataSource().`);
        }
        const dataSource: DataSourceInterface = await DiContainer.getInstance().injectAsync(dataSourceClass);
        const empty: boolean = request.emptyFor === dataSourceClass.name;
        const migration: GeneratedMigration | undefined = MigrationGeneratorUtilities.generate({
            previous: asked.snapshot,
            current: EntitySnapshotUtilities.resolveSnapshot(dataSourceClass.name, dataSource.entities),
            // one name for each data source, which records its migrations apart from the others
            name: request.name == undefined || dataSourceClasses.length === 1
                ? request.name
                : `${request.name}${dataSourceClass.name.replace(/DataSource$/, '')}`,
            takenNames: dataSource.migrations.map(m => m.name),
            dataSourceImport: asked.import,
            version,
            empty
        });
        if (migration == undefined) {
            return undefined;
        }
        return {
            dataSource: dataSourceClass.name,
            ...migration,
            // what an empty migration changes is not in the entities, so the snapshot stays
            snapshot: empty ? asked.snapshot : EntitySnapshotUtilities.resolveSnapshot(dataSourceClass.name, dataSource.entities)
        };
    }

    /**
     * Writes the snapshot of every data source that has none, and no migration: what its entities
     * declare is where its migrations start, for a database that holds it already.
     * @param request - What `zi migrate baseline` asked for.
     * @param dataSourceClasses - The data sources of the application.
     * @param responseFile - The file the snapshots are written into.
     * @throws When the request names no file for a data source, or every data source has a snapshot.
     */
    private static async writeBaselines(
        request: MigrationGenerationRequest,
        dataSourceClasses: Newable<DataSourceInterface>[],
        responseFile: string
    ): Promise<void> {
        const baselines: NonNullable<MigrationGenerationResponse['baselines']> = [];
        for (const dataSourceClass of dataSourceClasses) {
            const asked: MigrationGenerationRequest['dataSources'][string] | undefined = request.dataSources[dataSourceClass.name];
            if (asked == undefined) {
                throw new InternalError(`No file of the project declares the data source "${dataSourceClass.name}" with @DataSource().`);
            }
            // replacing a snapshot would take the changes since it out of the next migration
            if (asked.snapshot != undefined) {
                continue;
            }
            const dataSource: DataSourceInterface = await DiContainer.getInstance().injectAsync(dataSourceClass);
            baselines.push({
                dataSource: dataSourceClass.name,
                snapshot: EntitySnapshotUtilities.resolveSnapshot(dataSourceClass.name, dataSource.entities)
            });
        }
        if (!baselines.length) {
            throw new InternalError('Every data source has a snapshot already, so there is no baseline to write.');
        }
        const response: MigrationGenerationResponse = { migrations: [], baselines };
        await FsUtilities.upsertFile(FsUtilities.getPath(responseFile), JsonUtilities.stringify(response));
    }

    /**
     * Writes the migrations every data source has applied, in the order they ran.
     * @param dataSourceClasses - The data sources of the application.
     * @param logger - Where they are written.
     */
    private static async list(dataSourceClasses: Newable<DataSourceInterface>[], logger: LoggerInterface): Promise<void> {
        for (const dataSourceClass of dataSourceClasses) {
            const carried: Set<string> = new Set(inject(dataSourceClass).migrations.map(m => m.name));
            const applied: MigrationEntity[] = (await this.findApplied(dataSourceClass))
                .sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
            logger.info(`${dataSourceClass.name}: ${applied.length ? '' : 'no migrations applied'}`);
            for (const migration of applied) {
                const notCarried: string = carried.has(migration.name) ? '' : ' (not carried by this build)';
                logger.info(`  ${migration.ranAt.toISOString()}  ${migration.version}  ${migration.name}${notCarried}`);
            }
        }
    }

    /**
     * Reverts the migrations applied after the given target.
     *
     * A version, or all, is one every data source has, so each of them reverts what is newer. A
     * migration belongs to one data source, which is the one that recorded it.
     * @param target - Where reverting stops.
     * @param dataSourceClasses - The data sources of the application.
     * @throws When the target names a migration no data source has recorded.
     */
    private static async down(target: MigrationRevertTarget, dataSourceClasses: Newable<DataSourceInterface>[]): Promise<void> {
        if (!('migrationName' in target)) {
            for (const dataSourceClass of dataSourceClasses) {
                await inject(dataSourceClass).revertMigrationsAfter(target);
            }
            return;
        }
        const recordedBy: Newable<DataSourceInterface>[] = [];
        for (const dataSourceClass of dataSourceClasses) {
            if ((await this.findApplied(dataSourceClass)).some(m => m.name === target.migrationName)) {
                recordedBy.push(dataSourceClass);
            }
        }
        if (!recordedBy.length) {
            throw new InternalError(`No data source has recorded a migration named "${target.migrationName}".`);
        }
        for (const dataSourceClass of recordedBy) {
            await inject(dataSourceClass).revertMigrationsAfter(target);
        }
    }

    /**
     * Resolves where `migrate down` stops from what follows it.
     * @param target - `--all`, a version, or the name of a migration.
     * @returns Where reverting stops.
     */
    private static resolveRevertTarget(target: string): MigrationRevertTarget {
        if (target === '--all') {
            return { all: true };
        }
        return SemVerUtilities.isSemVerVersion(target) ? { version: target } : { migrationName: target };
    }

    /**
     * Finds the migrations a data source has recorded.
     * @param dataSourceClass - The data source.
     * @returns Every recorded migration.
     */
    private static async findApplied(dataSourceClass: Newable<DataSourceInterface>): Promise<MigrationEntity[]> {
        return await resolveMigrationRepository(dataSourceClass).findAll();
    }

    /**
     * Whether a value is what `zi migrate create` asks for.
     * @param value - The value, read from the file it was handed in.
     * @returns True when it has the shape of a request.
     */
    private static isGenerationRequest(value: unknown): value is MigrationGenerationRequest {
        if (typeof value !== 'object' || value == undefined || !('dataSources' in value)) {
            return false;
        }
        const { dataSources } = value;
        const name: unknown = 'name' in value ? value.name : undefined;
        const emptyFor: unknown = 'emptyFor' in value ? value.emptyFor : undefined;
        const baseline: unknown = 'baseline' in value ? value.baseline : undefined;
        return (name == undefined || typeof name === 'string')
            && (emptyFor == undefined || typeof emptyFor === 'string')
            && (baseline == undefined || typeof baseline === 'boolean')
            && typeof dataSources === 'object' && dataSources != undefined
            && Object.values(dataSources).every((d: unknown) => typeof d === 'object' && d != undefined
                && 'import' in d && typeof d.import === 'string'
                && (!('snapshot' in d) || d.snapshot == undefined || EntitySnapshotUtilities.isSnapshot(d.snapshot)));
    }
}