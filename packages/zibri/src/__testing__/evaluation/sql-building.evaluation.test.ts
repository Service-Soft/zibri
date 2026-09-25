import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md C5 - SQL is built by string concatenation.
 *
 * Every expectation here describes the fixed behavior, so the file is red until the finding is
 * closed. See ./README.md for why.
 *
 * The filter values below are the ones an application forwards from a request without thinking
 * about it - a search box, a facet, an id from a url. None of them require a caller who is trying
 * to attack anything, which is the point: a query builder that only survives well behaved input
 * is not a query builder.
 */

// ---------- Test entities ----------

class EvalSqlLineItem {
    @Property.string()
    sku!: string;
}

/**
 * The nested field is deliberately named in kebab case.
 *
 * A JSONB column is where payloads from somewhere else end up, and everywhere else in the world
 * spells things this way. It is a legal property name and a legal JSON key, so nothing about it is
 * adversarial - it is simply not a bare SQL identifier.
 */
class EvalSqlMetadata {
    @Property.string()
    label!: string;

    @Property.array({ items: { type: 'object', cls: () => EvalSqlLineItem } })
    'line-items'!: EvalSqlLineItem[];
}

@Entity({ allowOrphan: true })
class EvalSqlOrder extends BaseEntity {
    @Property.string()
    reference!: string;

    @Property.object({ cls: () => EvalSqlMetadata })
    metadata!: EvalSqlMetadata;

    @Property.oneToMany({ target: () => EvalSqlShipment, inverseSide: 'order' })
    shipments!: EvalSqlShipment[];
}

@Entity({ allowOrphan: true })
class EvalSqlShipment extends BaseEntity {
    @Property.string()
    tracking!: string;

    @Property.manyToOne({ target: () => EvalSqlOrder, joinColumn: 'orderId', inverseSide: 'shipments' })
    order!: EvalSqlOrder;

    @Property.string({ format: 'uuid' })
    orderId!: string;
}

@DataSource()
class EvalSqlDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db'
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, EvalSqlOrder, EvalSqlShipment];

    schemaManagement: SchemaManagement = 'synchronize';
}

const dataSourceClass: Newable<PostgresDataSource> = EvalSqlDataSource;

let server: StartedTestServer | undefined;
let orderRepository: Repository<EvalSqlOrder>;
let shipmentRepository: Repository<EvalSqlShipment>;

/**
 * Stores one order whose json column carries the given label.
 * @param label - The label to store, which is also what every test then filters for.
 * @returns The stored order.
 */
async function orderLabelled(label: string): Promise<EvalSqlOrder> {
    return await orderRepository.create({
        reference: 'ref',
        metadata: { label: label, 'line-items': [{ sku: 'sku-1' }] }
    });
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    orderRepository = inject(repositoryTokenFor(EvalSqlOrder));
    shipmentRepository = inject(repositoryTokenFor(EvalSqlShipment));
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

beforeEach(async () => {
    await shipmentRepository.deleteAll({});
    await orderRepository.deleteAll({});
});

describe('evaluation/01-data-layer C5 - values must not be able to change the query', () => {

    // Controls. They prove the fixture reaches the JSONB path at all, so that a red below is about
    // the value that was filtered for rather than about the filter never having worked.

    it('finds a row by an ordinary value inside a json column', async () => {
        const order: EvalSqlOrder = await orderLabelled('ordinary');

        const found: EvalSqlOrder[] = await orderRepository.findAll({ where: { metadata: { where: { label: 'ordinary' } } } });

        expect(found.map(o => o.id)).toEqual([order.id]);
    });

    it('finds a row whose json value contains a quote', async () => {
        const order: EvalSqlOrder = await orderLabelled('O\'Brien');

        const found: EvalSqlOrder[] = await orderRepository.findAll({ where: { metadata: { where: { label: 'O\'Brien' } } } });

        expect(found.map(o => o.id)).toEqual([order.id]);
    });

    // The reds.

    it('finds a row whose json value contains the placeholder the converter uses for the column', async () => {
        // $$COL$$ stands in for the column while the statement is assembled and is replaced by
        // string substitution afterwards, so a value carrying it is substituted too. The comparison
        // stops being "label equals this text" and becomes "label equals this column".
        const order: EvalSqlOrder = await orderLabelled('$$COL$$');

        const found: EvalSqlOrder[] = await orderRepository.findAll({ where: { metadata: { where: { label: '$$COL$$' } } } });

        expect(found.map(o => o.id)).toEqual([order.id]);
    });

    it('filters on a json field whose name is not a bare sql identifier', async () => {
        const order: EvalSqlOrder = await orderLabelled('kebab');

        // the field name is pasted into the statement as an identifier rather than quoted, so a
        // hyphen in it is read as an operator
        const found: EvalSqlOrder[] = await orderRepository.findAll({
            where: { metadata: { where: { 'line-items': { where: { sku: 'sku-1' } } } } }
        });

        expect(found.map(o => o.id)).toEqual([order.id]);
    });

    it('does not let an entity id decide which rows a relation filter matches', async () => {
        const order: EvalSqlOrder = await orderLabelled('relation');
        const shipment: EvalSqlShipment = await shipmentRepository.create({ tracking: 'T1', orderId: order.id });

        // ids are pasted in with no escaping at all - not even the quote doubling that values get -
        // so an id that is not the uuid the framework happens to generate rewrites the IN list
        // around it
        const found: EvalSqlOrder[] = await orderRepository.findAll({
            where: { shipments: { includes: [{ ...shipment, id: '\') OR (\'1\'=\'1' }] } }
        });

        expect(found).toHaveLength(0);
    });

    it('does not let an entity id contain the placeholder the converter uses for the alias', async () => {
        const order: EvalSqlOrder = await orderLabelled('relation');
        const shipment: EvalSqlShipment = await shipmentRepository.create({ tracking: 'T1', orderId: order.id });

        // the relation statement is assembled with $alias$ standing in for the column and is then
        // substituted by hand, so an id carrying it is substituted too. Separate mechanism from the
        // quoting above, same cause, and one parameterized statement would close both.
        //
        // It took one more thing than that. Binding the id stops it rewriting the statement, but
        // postgres then parses the bound text as a uuid and raises 22P02 - so both of these needed
        // the impossible-condition narrowing of 01 M21 to descend into a relation as well
        const found: EvalSqlOrder[] = await orderRepository.findAll({
            where: { shipments: { includes: [{ ...shipment, id: '$alias$' }] } }
        });

        expect(found).toHaveLength(0);
    });
});