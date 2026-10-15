import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, resetInMemoryStore } from 'zibri-testing';

import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { whereFor } from '../models/where/where-for.function';
import { Repository } from '../repository/repository';

/**
 * Indexes and uniques follow the entity: a boot creates what it declares and the store lacks, and
 * removes what the store keeps and it no longer declares. Each version of the widget below is the
 * same table as declared by another release, and the cases restart the application on the same store
 * with one release after the other.
 */

/**
 * The widget as a release declares it that keeps nothing besides its rows.
 */
@Entity({ tenant: 'shared', tableName: 'reconciled_widget', allowOrphan: true, allowDuplicate: true })
export class PlainWidget extends BaseEntity {
    /**
     * A code, which only some releases keep unique.
     */
    @Property.string()
    code!: string;

    /**
     * Where the widget is, which only some releases keep an index over.
     */
    @Property.string()
    shelf!: string;
}

/**
 * The widget as a release declares it that keeps its code unique and its shelf indexed.
 */
@Entity({ tenant: 'shared', tableName: 'reconciled_widget', allowOrphan: true, allowDuplicate: true, uniques: [['code']] })
export class KeyedWidget extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    code!: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ index: true })
    shelf!: string;
}

/**
 * The widget as a release declares it that keeps the code unique among the widgets on shelf x.
 */
@Entity({
    tenant: 'shared',
    tableName: 'reconciled_widget',
    allowOrphan: true,
    allowDuplicate: true,
    uniques: [{ properties: ['code'], where: whereFor<ShelfXWidget>({ shelf: 'x' }) }]
})
export class ShelfXWidget extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    code!: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    shelf!: string;
}

/**
 * The widget as a release declares it that keeps the code unique among the widgets on shelf y.
 */
@Entity({
    tenant: 'shared',
    tableName: 'reconciled_widget',
    allowOrphan: true,
    allowDuplicate: true,
    uniques: [{ properties: ['code'], where: whereFor<ShelfYWidget>({ shelf: 'y' }) }]
})
export class ShelfYWidget extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    code!: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    shelf!: string;
}

/**
 * The data source the cases run against.
 */
type ReconciledDataSource = {
    /**
     * Its class.
     */
    dataSourceClass: Newable<DataSourceInterface>,
    /**
     * The entities the class holds, the widget last - which the cases swap for another release of it
     * before each start.
     */
    entities: Newable<BaseEntity>[]
};

/**
 * A server the cases restart on the same store.
 */
type ReconciledServer = {
    /**
     * Starts the application again on the same store, with another release of the widget.
     * @param widget - The widget as that release declares it.
     * @param version - The version of the application.
     */
    restart: (widget: Newable<PlainWidget>, version: SemVerVersion) => Promise<void>,
    /**
     * The widgets, as the release started last declares them.
     */
    widgets: () => Repository<PlainWidget>,
    /**
     * Shuts the server down, and whatever it started for it.
     */
    shutdown: () => Promise<void>
};

/**
 * Runs every case against one data source.
 *
 * A case that ends with a boot failing has a server of its own, and is the last on it: a server
 * whose application failed to start is not one anything can be run against afterwards.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param reconciled - The data source, and the entities it holds.
 */
export function describeKeyReconciliation(dataSourceName: string, reconciled: ReconciledDataSource): void {
    // the framework's own entities, in a data source of their own that needs no container
    const frameworkDataSourceClass: Newable<DataSourceInterface> = createInMemoryDataSource({ entities: defaultTestServerEntities });
    let widget: Newable<PlainWidget> = PlainWidget;

    /**
     * Swaps the widget the data source holds for another release of it.
     * @param release - The widget as that release declares it.
     */
    function use(release: Newable<PlainWidget>): void {
        widget = release;
        reconciled.entities.splice(-1, 1, release);
    }

    /**
     * Starts a server on empty stores, with a release of the widget.
     * @param release - The widget as that release declares it.
     * @param version - The version of the application.
     * @returns The server.
     */
    async function start(release: Newable<PlainWidget>, version: SemVerVersion): Promise<ReconciledServer> {
        // a store in memory outlives the server it was started for, which a new server must not find
        resetInMemoryStore(frameworkDataSourceClass);
        resetInMemoryStore(reconciled.dataSourceClass);
        use(release);
        const server: StartedTestServer = await startTestServer({
            dataSources: [frameworkDataSourceClass, reconciled.dataSourceClass],
            // the versions this goes through in the server's own folder rather than the history the
            // suites share, where a version above every other suite's would refuse each of them
            providers: defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.VERSIONS_PATH),
            version
        });
        return {
            restart: async (next, nextVersion) => {
                use(next);
                await server.reInit({ version: nextVersion });
            },
            widgets: () => inject(reconciled.dataSourceClass).getRepository(widget),
            shutdown: async () => await server.shutdown()
        };
    }

    describe(`the indexes and uniques of ${dataSourceName}, following the entity`, () => {
        let server: ReconciledServer;
        let patch: number = 0;

        /**
         * A version above every one this server started with, as each release is.
         * @returns The version.
         */
        function nextVersion(): SemVerVersion {
            patch++;
            return `1.0.${patch}`;
        }

        beforeAll(async () => {
            server = await start(PlainWidget, nextVersion());
        }, 60000);

        afterAll(async () => {
            await server.shutdown();
        }, 30000);

        it('keeps a unique a release declares over the widgets stored before it', async () => {
            await server.widgets().deleteAll({});
            await server.widgets().createAll([{ code: 'a', shelf: 'x' }, { code: 'b', shelf: 'x' }]);

            await server.restart(KeyedWidget, nextVersion());

            await expect(server.widgets().create({ code: 'a', shelf: 'y' })).rejects.toThrow();
            await expect(server.widgets().create({ code: 'c', shelf: 'y' })).resolves.toBeDefined();
        }, 60000);

        it('finds every widget by an index a release declares, those stored before it included', async () => {
            await server.restart(PlainWidget, nextVersion());
            await server.widgets().deleteAll({});
            await server.widgets().createAll([{ code: 'a', shelf: 'x' }, { code: 'b', shelf: 'x' }, { code: 'c', shelf: 'y' }]);

            await server.restart(KeyedWidget, nextVersion());

            expect((await server.widgets().findAll({ where: { shelf: 'x' } })).map(w => w.code).sort()).toEqual(['a', 'b']);
            expect((await server.widgets().findAll({ where: { shelf: 'y' } })).map(w => w.code)).toEqual(['c']);
        }, 60000);

        it('stops keeping a unique the next release no longer declares', async () => {
            await server.restart(KeyedWidget, nextVersion());
            await server.widgets().deleteAll({});
            await server.widgets().create({ code: 'a', shelf: 'x' });

            await server.restart(PlainWidget, nextVersion());

            await expect(server.widgets().create({ code: 'a', shelf: 'x' })).resolves.toBeDefined();
        }, 60000);

        it('keeps a unique among the rows the release declares it over, when the rows it covers change', async () => {
            await server.restart(PlainWidget, nextVersion());
            await server.widgets().deleteAll({});
            await server.restart(ShelfXWidget, nextVersion());
            await server.widgets().createAll([{ code: 'a', shelf: 'x' }, { code: 'a', shelf: 'y' }]);
            await expect(server.widgets().create({ code: 'a', shelf: 'x' })).rejects.toThrow();

            await server.restart(ShelfYWidget, nextVersion());

            // the same property under another condition is another unique: the old one goes, so a
            // second widget on shelf x is fine, and the new one holds for shelf y
            await expect(server.widgets().create({ code: 'a', shelf: 'x' })).resolves.toBeDefined();
            await expect(server.widgets().create({ code: 'a', shelf: 'y' })).rejects.toThrow();
        }, 60000);
    });

    describe(`the indexes and uniques of ${dataSourceName}, broken by what is stored`, () => {
        let server: ReconciledServer;

        beforeAll(async () => {
            server = await start(PlainWidget, '1.0.0');
        }, 60000);

        afterAll(async () => {
            await server?.shutdown();
        }, 30000);

        it('refuses to start while stored widgets break a unique the release declares, naming the values', async () => {
            await server.widgets().createAll([{ code: 'twice', shelf: 'x' }, { code: 'twice', shelf: 'y' }]);

            await expect(server.restart(KeyedWidget, '1.1.0')).rejects.toThrow(/twice[\S\s]*Remove the duplicates in a migration/);
        }, 60000);
    });

    describe(`the indexes and uniques of ${dataSourceName}, after a newer release changed them`, () => {
        let server: ReconciledServer;

        beforeAll(async () => {
            server = await start(PlainWidget, '2.0.0');
        }, 60000);

        afterAll(async () => {
            await server.shutdown();
        }, 30000);

        it('refuses to start an older release, which would change them back', async () => {
            await server.restart(KeyedWidget, '2.1.0');

            await expect(server.restart(PlainWidget, '2.0.5')).rejects.toThrow(/zibri:indexes-and-uniques/);
        }, 60000);
    });
}