import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, resetInMemoryStore } from 'zibri-testing';

import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../backup/backup-entity.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

// evaluation/round-2/02-data-layer-stores.md S7: a restore put back the schema, the migration records
// and the indexes of whichever release took the backup, under instances built for another one

/**
 * The widget as the release that takes the backups declares it.
 */
@Entity({ tenant: 'shared', tableName: 'restored_widget', allowOrphan: true, allowDuplicate: true })
export class RestoredWidget extends BaseEntity {
    /**
     * A name, which only some releases keep unique.
     */
    @Property.string()
    name!: string;
}

/**
 * The widget as a later release declares it, which gave every widget a color.
 */
@Entity({ tenant: 'shared', tableName: 'restored_widget', allowOrphan: true, allowDuplicate: true })
export class ColoredWidget extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    name!: string;

    /**
     * The color, which the later release's migration gave every widget stored before it.
     */
    @Property.string()
    color!: string;
}

/**
 * The widget as a later release declares it, which keeps the name unique.
 */
@Entity({ tenant: 'shared', tableName: 'restored_widget', allowOrphan: true, allowDuplicate: true, uniques: [['name']] })
export class UniquelyNamedWidget extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    name!: string;
}

/**
 * The data source the cases run against.
 */
type RestoredDataSource = {
    /**
     * Its class.
     */
    dataSourceClass: Newable<DataSourceInterface>,
    /**
     * The entities the class holds, the widget last - which the cases swap for another release of it
     * before each start.
     */
    entities: Newable<BaseEntity>[],
    /**
     * The migrations the class holds, which the cases swap for another release's before each start.
     */
    migrations: Newable<Migration>[]
};

/**
 * What a release of the application is built from.
 */
type Release = {
    /**
     * The widget as the release declares it.
     */
    widget: Newable<BaseEntity>,
    /**
     * The migrations the release carries.
     */
    migrations: Newable<Migration>[],
    /**
     * The version of the release.
     */
    version: SemVerVersion
};

/**
 * A server the cases restart on the same store.
 */
type RestoredServer = {
    /**
     * Starts the application again on the same store, as another release.
     * @param release - The release.
     */
    restart: (release: Release) => Promise<void>,
    /**
     * Takes a backup of the data source.
     * @returns The backup.
     */
    backUp: () => Promise<Buffer>,
    /**
     * Restores a backup into the data source.
     * @param backup - The backup.
     */
    restore: (backup: Buffer) => Promise<void>,
    /**
     * Shuts the server down, and whatever it started for it.
     */
    shutdown: () => Promise<void>
};

/**
 * Runs every case against one data source.
 *
 * A case that ends with a boot failing is the last on its server: a server whose application failed
 * to start is not one anything can be run against afterwards.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param restored - The data source, and the entities and migrations it holds.
 */
export function describeRestoreMigrations(dataSourceName: string, restored: RestoredDataSource): void {
    // the framework's own entities, in a data source of their own that needs no container
    const frameworkDataSourceClass: Newable<DataSourceInterface> = createInMemoryDataSource({
        entities: defaultTestServerEntities,
        repositories: defaultTestServerRepositories
    });
    const { dataSourceClass, entities, migrations } = restored;

    /**
     * Creates the widget's table, as the release the store is first started with declares it.
     */
    @Injectable()
    class CreateRestoredWidgetTable extends Migration {
        /**
         * The release that carries it.
         */
        version: SemVerVersion = '0.0.1';

        constructor() {
            super(dataSourceClass);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.createEntity({ entity: RestoredWidget, properties: 'resolveFromEntity', transaction });
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new InternalError('Nothing reverts the widget\'s table.');
        }
    }

    /**
     * Gives every widget a color, grey for the ones stored before.
     */
    @Injectable()
    class AddColorToRestoredWidget extends Migration {
        /**
         * The release that carries it.
         */
        version: SemVerVersion = '1.1.0';

        constructor() {
            super(dataSourceClass);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.addPropertyToEntity({
                entity: ColoredWidget,
                property: { name: 'color', type: 'string', default: 'grey' },
                transaction
            });
        }

        override async down(transaction: Transaction): Promise<void> {
            await this.dataSource.removePropertyFromEntity({ entity: ColoredWidget, propertyKey: 'color', transaction });
        }
    }

    /**
     * Makes the data source the given release's.
     * @param release - The release.
     */
    function use(release: Release): void {
        entities.splice(-1, 1, release.widget);
        migrations.splice(0, migrations.length, ...release.migrations);
    }

    /**
     * Starts a server on empty stores, as a release.
     * @param release - The release.
     * @returns The server.
     */
    async function start(release: Release): Promise<RestoredServer> {
        // a store in memory outlives the server it was started for, which a new server must not find
        resetInMemoryStore(frameworkDataSourceClass);
        resetInMemoryStore(dataSourceClass);
        use(release);
        const server: StartedTestServer = await startTestServer({
            dataSources: [frameworkDataSourceClass, dataSourceClass],
            // the versions this goes through in the server's own folder rather than the history the
            // suites share, where a version above every other suite's would refuse each of them
            providers: defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.VERSIONS_PATH),
            version: release.version
        });
        // the data source ignores which backup the data is for
        const backup: BackupEntity = Object.assign(new BackupEntity(), { name: 'restored' });
        return {
            restart: async next => {
                use(next);
                await server.reInit({ version: next.version });
            },
            backUp: async () => await buffer(await inject(dataSourceClass).createBackupData(backup)),
            restore: async data => await inject(dataSourceClass).restoreBackup(Readable.from([data])),
            shutdown: async () => await server.shutdown()
        };
    }

    /**
     * The widgets, as the given release declares them.
     * @param widget - The widget as that release declares it.
     * @returns Their repository.
     */
    function widgetsOf<T extends BaseEntity>(widget: Newable<T>): Repository<T> {
        return inject(dataSourceClass).getRepository(widget);
    }

    /**
     * The migrations the data source records.
     * @returns Their repository.
     */
    function migrationRecords(): Repository<MigrationEntity> {
        return inject(repositoryTokenFor(MigrationEntity, dataSourceClass));
    }

    const first: Release = { widget: RestoredWidget, migrations: [CreateRestoredWidgetTable], version: '1.0.0' };
    const colored: Release = { widget: ColoredWidget, migrations: [CreateRestoredWidgetTable, AddColorToRestoredWidget], version: '1.1.0' };

    describe(`a backup of ${dataSourceName} restored by a later release that migrates it`, () => {
        let server: RestoredServer;

        beforeAll(async () => {
            server = await start(first);
            await widgetsOf(RestoredWidget).create({ name: 'backed up' });
            const backup: Buffer = await server.backUp();
            await server.restart(colored);
            await widgetsOf(ColoredWidget).create({ name: 'after the backup', color: 'red' });

            await server.restore(backup);
        }, 120000);

        afterAll(async () => {
            await server?.shutdown();
        }, 30000);

        it('runs the migrations the backup has not recorded over what it holds', async () => {
            expect((await widgetsOf(ColoredWidget).findAll()).map(w => [w.name, w.color])).toEqual([['backed up', 'grey']]);
            expect((await migrationRecords().findAll()).map(m => m.name)).toContain(AddColorToRestoredWidget.name);
        }, 30000);

        it('stores what the later release declares', async () => {
            await widgetsOf(ColoredWidget).create({ name: 'after the restore', color: 'blue' });

            expect((await widgetsOf(ColoredWidget).findAll({ where: { color: 'blue' } })).map(w => w.name)).toEqual(['after the restore']);
        }, 30000);
    });

    describe(`a backup of ${dataSourceName} restored by a later release that declares other uniques`, () => {
        let server: RestoredServer;

        beforeAll(async () => {
            server = await start(first);
            await widgetsOf(RestoredWidget).create({ name: 'backed up' });
            const backup: Buffer = await server.backUp();
            await server.restart({ widget: UniquelyNamedWidget, migrations: [CreateRestoredWidgetTable], version: '1.1.0' });

            await server.restore(backup);
        }, 120000);

        afterAll(async () => {
            await server?.shutdown();
        }, 30000);

        it('keeps the uniques the later release declares over what it holds', async () => {
            await expect(widgetsOf(UniquelyNamedWidget).create({ name: 'backed up' })).rejects.toThrow();
        }, 30000);

        // the last case on this server: the release it starts refuses to
        it('refuses to start an older release afterwards, which would change them back', async () => {
            await expect(server.restart({ ...first, version: '1.0.5' })).rejects.toThrow(/zibri:indexes-and-uniques/);
        }, 60000);
    });

    describe(`a backup of ${dataSourceName} that a newer release took`, () => {
        let server: RestoredServer;
        let backup: Buffer;

        beforeAll(async () => {
            server = await start(first);
            // what a newer release leaves behind, as the backup it took holds it: a migration this
            // release does not know, and the rows it wrote
            const newer: MigrationEntity = await migrationRecords().create({
                name: 'FromANewerRelease',
                version: '2.0.0',
                ranAt: new Date()
            });
            await widgetsOf(RestoredWidget).create({ name: 'from the newer release' });
            backup = await server.backUp();
            await migrationRecords().deleteById(newer.id);
        }, 120000);

        afterAll(async () => {
            await server?.shutdown();
        }, 30000);

        it('is refused, naming what the newer release stored', async () => {
            const restore: Promise<void> = server.restore(backup);

            await expect(restore).rejects.toThrow('"FromANewerRelease" (2.0.0)');
            await expect(restore).rejects.toThrow('Restore it with a build of that version or a newer one.');
        }, 60000);
    });
}