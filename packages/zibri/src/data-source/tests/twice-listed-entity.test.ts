import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { indexName } from '../index-name.function.ts';
import { whereFor } from '../models/where/where-for.function.ts';

/**
 * Belongs to a tenant and declares a unique over some of its rows, so that its table carries indices
 * of both kinds: the tenant's, which nothing declared starts with, and the declared one.
 */
@Entity({
    allowOrphan: true,
    uniques: [{ properties: ['label'], where: whereFor<TwiceListedNote>({ archived: false }) }]
})
class TwiceListedNote extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    label!: string;

    @Property.boolean()
    archived!: boolean;
}

let server: StartedTestServer;
let dataSource: PostgresDataSource;

// the same class twice, the way spreading the defaults and then naming one of them again lists it
const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TwiceListedNote, TwiceListedNote]
});

describe('an entity listed twice in one data source', () => {
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('is one entity, with each of its indices created once', async () => {
        const rows: { indexname: string }[] = await dataSource.query(TwiceListedNote).connection.query(
            'SELECT indexname FROM pg_indexes WHERE tablename = $1',
            ['twice_listed_note']
        );
        const names: string[] = rows.map(r => r.indexname);

        expect(names.filter(n => n === indexName('twice_listed_note', ['tenantId']))).toHaveLength(1);
        expect(names.filter(n => n.startsWith('uq_twice_listed_note_'))).toHaveLength(1);
    });
});