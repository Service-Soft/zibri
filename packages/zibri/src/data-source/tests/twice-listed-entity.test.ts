import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { indexName } from '../index-name.function';

/**
 * Belongs to a tenant and declares an index, so that its table carries indices of both kinds.
 */
@Entity({ allowOrphan: true })
class TwiceListedNote extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string({ index: true })
    label!: string;
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
    }, 15000);

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
        expect(names.filter(n => n === indexName('twice_listed_note', ['tenantId', 'label']))).toHaveLength(1);
    });
});