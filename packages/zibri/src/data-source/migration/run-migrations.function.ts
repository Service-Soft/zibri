import { MigrationEntity } from './migration-entity.model';
import { MigrationRevertTarget } from './migration-revert-target.model';
import { Migration } from './migration.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { SemVerUtilities, SemVerVersion } from '../../utilities/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';

// eslint-disable-next-line jsdoc/require-jsdoc
export type MigrationWithName = { migration: Migration, name: string };

/**
 * The name a data source records under when it changes its indexes and uniques to match the entities.
 *
 * Kept with the migrations because it is the same kind of record: a change to what is stored, made
 * by one version of the app, that an older version was never built for.
 */
export const KEY_RECONCILIATION_NAME: string = 'zibri:indexes-and-uniques';

/**
 * Applies every migration of a data source that the database has not recorded yet.
 *
 * This is independent of the underlying storage and shared by all data sources.
 *
 * Nothing is ever reverted here. A database holding a migration this app does not know about is a
 * database this app is not compatible with, so it refuses to start rather than making the schema
 * match itself - see {@link revertMigrationsAfter} for the deliberate way back.
 * @param dataSourceClass - The data source that the migrations belong to.
 * Needed because the MigrationEntity exists in every data source.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @throws When no app version could be resolved, or the database is ahead of this app.
 */
export async function runMigrations(
    dataSourceClass: Newable<DataSourceInterface>,
    migrations: Newable<Migration>[],
    logger: LoggerInterface
): Promise<void> {
    const appVersion: SemVerVersion = resolveAppVersion();
    // read before the early return below, because being older than the database is a question about
    // this app that has nothing to do with which migrations it happens to carry
    const applied: MigrationEntity[] = await appliedMigrations(dataSourceClass);

    validateDatabaseIsNotAhead(applied, migrations, appVersion);

    await runUpMissing(applied, migrations, logger, appVersion);
}

/**
 * Applies every migration of a data source that a backup restored into it has not recorded.
 *
 * What a data source runs right after a restore, so that what the backup holds is stored the way this
 * version of the app expects: a backup taken by an older version gets the migrations it lacks.
 * @param dataSourceClass - The data source that the migrations belong to.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @throws When no app version could be resolved, or the backup was taken by a newer version of the
 * app, which has to restore it instead.
 */
export async function runMigrationsAfterRestore(
    dataSourceClass: Newable<DataSourceInterface>,
    migrations: Newable<Migration>[],
    logger: LoggerInterface
): Promise<void> {
    const appVersion: SemVerVersion = resolveAppVersion();
    const applied: MigrationEntity[] = await appliedMigrations(dataSourceClass);

    // a refusal of its own rather than the one booting gives: nothing about this is a newer instance
    // still serving, and reverting is no way out - what has to change is which build restores it
    const ahead: MigrationEntity[] = findAhead(applied, migrations, appVersion);
    if (ahead.length) {
        throw new InternalError([
            `This app is version ${appVersion}, but the backup restored into "${dataSourceClass.name}" holds`,
            `what a newer build stored: ${namesOf(ahead)}.`,
            'A build runs on no schema newer than its own, so the backup is refused.',
            'Restore it with a build that carries those migrations.'
        ]);
    }

    await runUpMissing(applied, migrations, logger, appVersion);
}

/**
 * Applies every migration the database has not recorded and that belongs to this version of the app
 * or an older one.
 * @param applied - Every migration the database has recorded.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @param appVersion - The version of the running app.
 */
async function runUpMissing(
    applied: MigrationEntity[],
    migrations: Newable<Migration>[],
    logger: LoggerInterface,
    appVersion: SemVerVersion
): Promise<void> {
    if (!migrations.length) {
        return;
    }

    // by name, because that is which migration this is. The version says which app versions the
    // schema state belongs to, and two changes shipping in one release share it - so reading
    // applied-ness off the version made the second one of a release applied the moment the first
    // recorded itself, and it silently never ran
    const appliedNames: string[] = applied.map(m => m.name);
    const allMigrations: MigrationWithName[] = migrations.map(m => ({ migration: inject(m), name: m.name }));

    const migrationsToRunUp: MigrationWithName[] = allMigrations.filter(m => {
        return !appliedNames.includes(m.name)
            && SemVerUtilities.compare(m.migration.version, appVersion) !== 'bigger';
    });

    for (const migration of migrationsToRunUp) {
        logger.info(`    > runs up migration ${migration.name}`);
        await migration.migration.runUp();
    }

    const skipped: number = allMigrations.length - migrationsToRunUp.length;
    if (skipped) {
        logger.info(`    > skipped ${skipped} migrations that have already been applied`);
    }
}

/**
 * Reverts every migration applied after the given version or migration, newest first.
 *
 * Deliberate and operator driven, which is the whole point of it being separate from booting. Rolling
 * an application back past a migration means taking the schema back too, and that is a destructive
 * step somebody has to choose: the order is stop the newer instances, revert, then deploy the older
 * build. Doing it while a newer instance is still serving takes the schema out from under it.
 * @param dataSourceClass - The data source that the migrations belong to.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @param target - Where reverting stops: everything of a newer version, or everything applied after
 * the named migration, is reverted.
 * @throws When the database holds a migration this build does not carry, so there is no `down` to run,
 * or the target names a migration the database has not recorded.
 */
export async function revertMigrationsAfter(
    dataSourceClass: Newable<DataSourceInterface>,
    migrations: Newable<Migration>[],
    logger: LoggerInterface,
    target: MigrationRevertTarget
): Promise<void> {
    const applied: MigrationEntity[] = await appliedMigrations(dataSourceClass);
    const isAfterTarget: (migration: MigrationEntity) => boolean = resolveIsAfterTarget(applied, target);
    const recorded: MigrationEntity[] = applied.filter(m => m.name !== KEY_RECONCILIATION_NAME && isAfterTarget(m));
    const reconciliation: MigrationEntity | undefined = applied.find(m => m.name === KEY_RECONCILIATION_NAME && isAfterTarget(m));
    const targetName: string = describeTarget(target);

    if (!recorded.length && reconciliation == undefined) {
        const since: string = 'all' in target ? '' : ` after ${targetName}`;
        logger.info(`No migration was applied${since}, so there is nothing to revert.`);
        return;
    }

    await revertRecorded(recorded, migrations, logger, targetName);

    // forgotten rather than reverted, and only once the migrations are: there is no down to run and
    // none is needed - the build returned to brings the indexes and uniques back to what its own
    // entities declare when it boots, which this record would otherwise refuse to let it do
    if (reconciliation != undefined) {
        await resolveMigrationRepository(dataSourceClass).deleteById(reconciliation.id);
        logger.info(`    > leaves the indexes and uniques of ${reconciliation.version} to the build reverted to`);
    }
}

/**
 * Resolves which recorded migrations were applied after the given target.
 * @param applied - Every migration the database has recorded.
 * @param target - Where reverting stops.
 * @returns Whether a recorded migration was applied after it.
 * @throws When the target names a migration the database has not recorded.
 */
function resolveIsAfterTarget(applied: MigrationEntity[], target: MigrationRevertTarget): (migration: MigrationEntity) => boolean {
    if ('all' in target) {
        return () => true;
    }
    if ('version' in target) {
        return m => SemVerUtilities.compare(m.version, target.version) === 'bigger';
    }
    const named: MigrationEntity | undefined = applied.find(m => m.name === target.migrationName);
    if (named == undefined) {
        throw new InternalError(`Cannot revert to "${target.migrationName}": the database has recorded no migration of that name.`);
    }
    // by when they ran, which is the order they were applied in rather than the order this build lists
    // them in: going back to an earlier commit means undoing what ran after its newest migration,
    // including one a merged branch put further up the list
    return m => m.ranAt.getTime() > named.ranAt.getTime();
}

/**
 * Names where reverting stops, for messages.
 * @param target - Where reverting stops.
 * @returns The version, the quoted migration name, or the start for every migration.
 */
function describeTarget(target: MigrationRevertTarget): string {
    if ('all' in target) {
        return 'before the first migration';
    }
    return 'version' in target ? target.version : `"${target.migrationName}"`;
}

/**
 * Reverts the given recorded migrations, newest first.
 * @param recorded - The recorded migrations to revert.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @param targetName - The version or migration the database is being brought back to, for messages.
 * @throws When one of them is not carried by this build, so there is no `down` to run.
 */
async function revertRecorded(
    recorded: MigrationEntity[],
    migrations: Newable<Migration>[],
    logger: LoggerInterface,
    targetName: string
): Promise<void> {
    const declared: MigrationWithName[] = migrations.map(m => ({ migration: inject(m), name: m.name }));
    const declaredNames: Set<string> = new Set(declared.map(m => m.name));

    const missing: MigrationEntity[] = recorded.filter(m => !declaredNames.has(m.name));
    if (missing.length) {
        throw new InternalError([
            `Cannot revert to ${targetName}:`,
            `the database recorded ${namesOf(missing)},`,
            'which this build does not carry, so there is no down migration to run.',
            'Revert from a build that contains them.'
        ]);
    }

    const revertedNames: Set<string> = new Set(recorded.map(m => m.name));
    // the reverse of the order they were applied in, which is the reverse of the order the data
    // source declares them: a later migration may depend on what an earlier one did, so undoing them
    // forwards takes the ground out from under its own next step. Sorting by version cannot say
    // which came first among the changes of one release, because they share one
    const toRevert: MigrationWithName[] = declared.filter(m => revertedNames.has(m.name)).reverse();

    for (const migration of toRevert) {
        logger.info(`    > runs down migration ${migration.name}`);
        await migration.migration.runDown();
    }
}

/**
 * Records that this version of the app changed the indexes and uniques of a data source.
 *
 * What makes an older version refuse to start afterwards, the way it refuses a database migrated past
 * it: one booting after this would otherwise change them back to what its own entities declare,
 * taking away a unique the newer instances rely on.
 * @param dataSourceClass - The data source whose indexes and uniques changed.
 * @throws When no app version could be resolved.
 */
export async function recordKeyReconciliation(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {
    const version: SemVerVersion = resolveAppVersion();
    const migrationsRepository: Repository<MigrationEntity> = resolveMigrationRepository(dataSourceClass);
    const recorded: MigrationEntity | undefined = (await migrationsRepository.findAll({ where: { name: KEY_RECONCILIATION_NAME } })).at(0);
    if (recorded == undefined) {
        await migrationsRepository.create({ name: KEY_RECONCILIATION_NAME, version, ranAt: new Date() });
        return;
    }
    await migrationsRepository.updateById(recorded.id, { version, ranAt: new Date() });
}

/**
 * Refuses to continue when the database has been migrated past what this app was built for.
 *
 * The app version is what says which schema this build expects - the same version its routes declare
 * themselves against - so a database beyond it is not a state this build has ever been compatible
 * with. It used to be made to match by running the down migrations, which is the worst of the three
 * options available: an instance that arrives late, or a rollback, would take the schema away from
 * the healthy instances still serving on it, and a `down` that drops a column takes the data too.
 * Refusing costs this one instance; reverting costs the cluster.
 * @param applied - Every migration the database has recorded.
 * @param migrations - The migration classes this build carries.
 * @param appVersion - The version of the running app.
 * @throws When any applied migration belongs to a newer version than the app, or to a newer build.
 */
function validateDatabaseIsNotAhead(applied: MigrationEntity[], migrations: Newable<Migration>[], appVersion: SemVerVersion): void {
    const ahead: MigrationEntity[] = findAhead(applied, migrations, appVersion);
    if (!ahead.length) {
        return;
    }

    // what the newer build is told to go back to: the newest migration of this one, or all of them
    // when this build applied none - every recorded migration is then ahead of it (see findAhead)
    const target: string = findNewestCarried(applied, migrations)?.name ?? '--all';
    throw new InternalError([
        `This app is version ${appVersion}, but its database has already been migrated by a newer build:`,
        `${namesOf(ahead)}.`,
        'Running an older instance against a newer schema is not supported, so it refuses to start',
        'rather than reverting the schema that the newer instances are using.',
        `To go back to this build: stop the newer instances, run "migrate down ${target}" with the newer build, then start this one.`
    ]);
}

/**
 * Finds the recorded migrations that a newer build of the app applied.
 *
 * Those of a newer version, and those this build does not carry that ran after the newest of its own
 * that ran. The version alone cannot tell an earlier commit of the same release from the one that
 * added a migration, and every commit of a release shares it. A migration this build does not carry
 * and that ran before its own is one taken out of the code base once it ran everywhere.
 * @param applied - Every migration the database has recorded.
 * @param migrations - The migration classes this build carries.
 * @param appVersion - The version of the running app.
 * @returns The ones a newer build applied.
 */
function findAhead(applied: MigrationEntity[], migrations: Newable<Migration>[], appVersion: SemVerVersion): MigrationEntity[] {
    const carried: Set<string> = new Set(migrations.map(m => m.name));
    const newestCarried: MigrationEntity | undefined = findNewestCarried(applied, migrations);
    return applied.filter(m => SemVerUtilities.compare(m.version, appVersion) === 'bigger'
        || (
            m.name !== KEY_RECONCILIATION_NAME
            && !carried.has(m.name)
            && (newestCarried == undefined || m.ranAt.getTime() > newestCarried.ranAt.getTime())
        ));
}

/**
 * Finds the recorded migration this build carries that ran last.
 * @param applied - Every migration the database has recorded.
 * @param migrations - The migration classes this build carries.
 * @returns The one that ran last, if this build carries any that ran.
 */
function findNewestCarried(applied: MigrationEntity[], migrations: Newable<Migration>[]): MigrationEntity | undefined {
    const carried: Set<string> = new Set(migrations.map(m => m.name));
    // by when they ran rather than by a version, which is the order they were applied in: each is
    // recorded after every one before it, whatever the clock of the instance that ran it says
    return applied
        .filter(m => carried.has(m.name))
        .reduce<MigrationEntity | undefined>((newest, m) => newest == undefined || m.ranAt > newest.ranAt ? m : newest, undefined);
}

/**
 * Names migrations in a message, so an operator can tell which ones are meant.
 * @param entities - The recorded migrations to name.
 * @returns Their names and versions, comma separated.
 */
function namesOf(entities: MigrationEntity[]): string {
    return entities.map(m => `"${m.name}" (${m.version})`).join(', ');
}

/**
 * Reads which migrations the database has recorded.
 * @param dataSourceClass - The data source to read from.
 * @returns Every recorded migration.
 */
async function appliedMigrations(dataSourceClass: Newable<DataSourceInterface>): Promise<MigrationEntity[]> {
    return await resolveMigrationRepository(dataSourceClass).findAll();
}

/**
 * Resolves the repository a data source keeps its migrations in.
 *
 * Injected here rather than taken as a parameter, because the repositories do not exist yet while the
 * data source is being constructed.
 * @param dataSourceClass - The data source.
 * @returns The repository.
 * @throws When the data source does not declare MigrationEntity.
 */
export function resolveMigrationRepository(dataSourceClass: Newable<DataSourceInterface>): Repository<MigrationEntity> {
    // asked here, where every reader of the records goes through: without it the boot failed on a
    // repository provider that is missing, naming neither the entity nor what to do
    if (!inject(dataSourceClass).entities.includes(MigrationEntity)) {
        throw new InternalError([
            `The data source "${dataSourceClass.name}" keeps the migrations it applied,`,
            'and does not declare MigrationEntity to keep them in.',
            'Add MigrationEntity to its entities.'
        ]);
    }
    return inject(repositoryTokenFor(MigrationEntity, dataSourceClass));
}

/**
 * Reads the version of the running app.
 * @returns The version.
 * @throws When no app version could be resolved.
 */
function resolveAppVersion(): SemVerVersion {
    const appVersion: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
    if (!appVersion) {
        throw new InternalError('Couldn\'t run migrations: No app version could be resolved');
    }
    return appVersion;
}