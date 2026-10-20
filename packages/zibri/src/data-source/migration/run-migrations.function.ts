import { MigrationEntity } from './migration-entity.model.ts';
import { Migration } from './migration.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { SemVerUtilities, SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { DataSourceInterface } from '../data-sources/data-source.interface.ts';
import { Repository } from '../repository/repository.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
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

    validateDatabaseIsNotAhead(applied, appVersion);

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
 * Reverts every applied migration belonging to a version newer than the given one, newest first.
 *
 * Deliberate and operator driven, which is the whole point of it being separate from booting. Rolling
 * an application back past a migration means taking the schema back too, and that is a destructive
 * step somebody has to choose: the order is stop the newer instances, revert, then deploy the older
 * build. Doing it while a newer instance is still serving takes the schema out from under it.
 * @param dataSourceClass - The data source that the migrations belong to.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @param targetVersion - The version to bring the database back to. Everything above it is reverted.
 * @throws When the database holds a migration this build does not carry, so there is no `down` to run.
 */
export async function revertMigrationsAfter(
    dataSourceClass: Newable<DataSourceInterface>,
    migrations: Newable<Migration>[],
    logger: LoggerInterface,
    targetVersion: SemVerVersion
): Promise<void> {
    const applied: MigrationEntity[] = await appliedMigrations(dataSourceClass);
    const recorded: MigrationEntity[] = applied.filter(m => m.name !== KEY_RECONCILIATION_NAME
        && SemVerUtilities.compare(m.version, targetVersion) === 'bigger');
    const reconciliation: MigrationEntity | undefined = applied.find(m => m.name === KEY_RECONCILIATION_NAME
        && SemVerUtilities.compare(m.version, targetVersion) === 'bigger');

    if (!recorded.length && reconciliation == undefined) {
        logger.info(`No migration is newer than ${targetVersion}, so there is nothing to revert.`);
        return;
    }

    await revertRecorded(recorded, migrations, logger, targetVersion);

    // forgotten rather than reverted, and only once the migrations are: there is no down to run and
    // none is needed - the build returned to brings the indexes and uniques back to what its own
    // entities declare when it boots, which this record would otherwise refuse to let it do
    if (reconciliation != undefined) {
        await inject(repositoryTokenFor(MigrationEntity, dataSourceClass)).deleteById(reconciliation.id);
        logger.info(`    > leaves the indexes and uniques of ${reconciliation.version} to the build reverted to`);
    }
}

/**
 * Reverts the given recorded migrations, newest first.
 * @param recorded - The recorded migrations to revert.
 * @param migrations - The migration classes of the data source.
 * @param logger - The logger to report the progress with.
 * @param targetVersion - The version the database is being brought back to.
 * @throws When one of them is not carried by this build, so there is no `down` to run.
 */
async function revertRecorded(
    recorded: MigrationEntity[],
    migrations: Newable<Migration>[],
    logger: LoggerInterface,
    targetVersion: SemVerVersion
): Promise<void> {
    const declared: MigrationWithName[] = migrations.map(m => ({ migration: inject(m), name: m.name }));
    const declaredNames: Set<string> = new Set(declared.map(m => m.name));

    const missing: MigrationEntity[] = recorded.filter(m => !declaredNames.has(m.name));
    if (missing.length) {
        throw new InternalError([
            `Cannot revert to ${targetVersion}:`,
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
    const migrationsRepository: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, dataSourceClass));
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
 * @param appVersion - The version of the running app.
 * @throws When any applied migration belongs to a newer version than the app.
 */
function validateDatabaseIsNotAhead(applied: MigrationEntity[], appVersion: SemVerVersion): void {
    const ahead: MigrationEntity[] = applied.filter(m => SemVerUtilities.compare(m.version, appVersion) === 'bigger');
    if (!ahead.length) {
        return;
    }

    throw new InternalError([
        `This app is version ${appVersion}, but its database has already been migrated to`,
        `${namesOf(ahead)}.`,
        'Running an older instance against a newer schema is not supported, so it refuses to start',
        'rather than reverting the schema that the newer instances are using.',
        'To go back deliberately: stop the newer instances, revert the migrations, then deploy this build.'
    ]);
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
    // injected here rather than taken as a parameter, because the repositories do not exist yet while
    // the data source is being constructed
    const migrationsRepository: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, dataSourceClass));
    return await migrationsRepository.findAll();
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