import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { indexName, trigramIndexName, TRIGRAM_INDEX_PREFIX } from '../index-name.function';
import { Repository } from '../repository/repository';
import { uniqueConstraintName } from '../unique-constraint-name.function';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities';

/**
 * What an entity declares about the lookups it expects.
 *
 * An index is invisible from the application: the same rows come back either way, and the only
 * difference is whether the database read the whole table to find them. So what is asserted is that
 * the declaration reaches the schema, under a name a migration can refer to, and that the two places
 * it can be made - the property and the entity - arrive as one list.
 */

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    // `tenantId` carries no `index` of its own: this group already answers a lookup by it, since an
    // index answers any leading part of itself
    indexes: [['tenantId', 'status']]
})
class IndexedOrder extends BaseEntity {
    @Property.string({ unique: true })
    reference!: string;

    @Property.string()
    tenantId!: string;

    @Property.string()
    status!: string;

    @Property.string({ fuzzySearchable: false })
    note!: string;

    @Property.string({ format: 'uuid' })
    customerId!: string;

    @Property.date({ index: true })
    placedAt!: Date;

    @Property.manyToMany({ target: () => IndexedTag, inverseSide: 'orders', joinTable: true })
    tags!: IndexedTag[];
}

/**
 * Exists so that the schema carries a junction table, which the orm builds rather than an entity
 * declaring it - and which therefore has no class behind it to read declarations from.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class IndexedTag extends BaseEntity {
    @Property.string()
    label!: string;

    @Property.manyToMany({ target: () => IndexedOrder, inverseSide: 'tags', joinTable: false })
    orders!: IndexedOrder[];
}

let server: StartedTestServer;
let dataSource: PostgresDataSource;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, IndexedOrder, IndexedTag]
});

describe('an entity that declares indexes', () => {
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
    }, 30000);

    it('collects both ways of declaring one into a single list', () => {
        // the order of a group is kept rather than normalized: an index on (tenantId, status)
        // answers a lookup by tenantId, and one on (status, tenantId) does not
        expect(ModelRegistry.get(IndexedOrder).keyDescriptor.indexes).toEqual([['placedAt'], ['tenantId', 'status']]);
    });

    /**
     * Every index the database currently has on the given table.
     * @param tableName - The table to read them from.
     * @returns The name of each one.
     */
    async function indexNamesOf(tableName: string): Promise<string[]> {
        const rows: { indexname: string }[] = await dataSource.query(IndexedOrder).connection.query(
            'SELECT indexname FROM pg_indexes WHERE tablename = $1',
            [tableName]
        );
        return rows.map(r => r.indexname);
    }

    /**
     * Every table the schema currently has.
     * @returns The name of each one.
     */
    async function tableNames(): Promise<string[]> {
        const rows: { tablename: string }[] = await dataSource.query(IndexedOrder).connection.query(
            'SELECT tablename FROM pg_tables WHERE schemaname = current_schema()'
        );
        return rows.map(r => r.tablename);
    }

    it('creates them in the database, named so a migration can refer to them', async () => {
        const names: string[] = await indexNamesOf('indexed_order');

        expect(names).toContain(indexName('indexed_order', ['placedAt']));
        expect(names).toContain(indexName('indexed_order', ['tenantId', 'status']));
    });

    it('keeps a trigram index for every property a similarity can be asked of, and for no other', async () => {
        const names: string[] = await indexNamesOf('indexed_order');

        expect(names).toContain(trigramIndexName('indexed_order', 'reference'));
        expect(names).toContain(trigramIndexName('indexed_order', 'tenantId'));
        expect(names).toContain(trigramIndexName('indexed_order', 'status'));
        // a value nobody searches and one that is drawn at random. The second is the same rule that
        // keeps the collation off a uuid column
        expect(names).not.toContain(trigramIndexName('indexed_order', 'note'));
        expect(names).not.toContain(trigramIndexName('indexed_order', 'customerId'));
    });

    it('asks nothing of a junction table, which has no class to read declarations from', async () => {
        // the orm builds one of these itself, so its metadata names it with a string where an entity
        // names its class. It holds two foreign keys, and neither is anything to search
        const junction: string | undefined = (await tableNames()).find(t => t.includes('indexed_order') && t !== 'indexed_order');

        expect(junction).toBeDefined();
        expect(await indexNamesOf(junction ?? '')).toEqual(
            expect.not.arrayContaining([expect.stringContaining(TRIGRAM_INDEX_PREFIX)])
        );
    });

    it('builds it over the trigrams rather than over the value', async () => {
        const rows: { indexdef: string }[] = await dataSource.query(IndexedOrder).connection.query(
            'SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
            ['indexed_order', trigramIndexName('indexed_order', 'reference')]
        );

        // the operator class is the whole point: without it the index answers equality and ordering,
        // which is what the column already has, and nothing about similarity
        expect(rows[0]?.indexdef).toContain('USING gin');
        expect(rows[0]?.indexdef).toContain('gin_trgm_ops');
    });

    it('survives the orm bringing the schema in line again', async () => {
        // the orm drops every index on a table it did not put there, so an index it does not know how
        // to write would be rebuilt on every boot. It is declared to it as not its own, and this is
        // what says that declaration took
        await dataSource.query(IndexedOrder).connection.synchronize();

        expect(await indexNamesOf('indexed_order')).toContain(trigramIndexName('indexed_order', 'reference'));
    });

    it('lets a property that declares itself unique identify a row for an upsert', () => {
        // without the same column being named a second time under the entity's `uniques`. The rows
        // it covers come back with it, because an identity only names one row while the key covers
        // every row it could be
        expect(UpsertIdentityUtilities.resolveUniqueGroup(IndexedOrder, ['reference'])).toEqual({ properties: ['reference'], where: undefined });
    });

    it('names a property\'s own unique the way an upsert refers to it, and creates it once', async () => {
        const rows: { conname: string }[] = await dataSource.query(IndexedOrder).connection.query(
            'SELECT conname FROM pg_constraint WHERE conrelid = \'indexed_order\'::regclass AND contype = \'u\''
        );

        // it used to reach the column as the orm's own unique, under a hashed name nothing else can
        // arrive at - so an upsert naming the constraint named one that did not exist
        expect(rows.map(r => r.conname)).toEqual([uniqueConstraintName('indexed_order', ['reference'])]);
    });

    it('lands an upsert identified by that property on the row holding it', async () => {
        const orders: Repository<IndexedOrder> = dataSource.getRepository(IndexedOrder);
        const reference: string = UUIDUtilities.generate();
        const order: Partial<IndexedOrder> = {
            reference,
            tenantId: 'tenant',
            status: 'open',
            note: '',
            customerId: UUIDUtilities.generate(),
            placedAt: new Date()
        };

        const first: IndexedOrder = await orders.upsert({ reference }, order, { status: { set: 'paid' } });
        const second: IndexedOrder = await orders.upsert({ reference }, order, { status: { set: 'paid' } });

        // the whole of what the resolution above is for, which checking the resolution alone never ran
        expect(first.status).toBe('open');
        expect(second.id).toBe(first.id);
        expect(second.status).toBe('paid');
    });

    it('refuses an identity that nothing declares unique', () => {
        expect(() => UpsertIdentityUtilities.resolveUniqueGroup(IndexedOrder, ['status'])).toThrow();
    });

    afterAll(async () => {
        await server.shutdown();
    }, 15000);
});