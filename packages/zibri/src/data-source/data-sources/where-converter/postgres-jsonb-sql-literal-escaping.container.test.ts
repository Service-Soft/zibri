import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Repository } from '../../repository/repository';

class ContactDetails {
    @Property.string()
    lastName!: string;

    @Property.string()
    note!: string;
}

@Entity({ tenant: 'shared' })
class Contact extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => ContactDetails, required: false })
    details: ContactDetails | undefined | null;
}

class LineItem {
    @Property.string()
    sku!: string;
}

/**
 * Its nested field is named in kebab case, the way payloads from elsewhere spell things: a legal property
 * and json key, and not a bare sql identifier.
 */
class OrderMetadata {
    @Property.string()
    label!: string;

    @Property.array({ items: { type: 'object', cls: () => LineItem } })
    'line-items'!: LineItem[];
}

@Entity({ tenant: 'shared' })
class Order extends BaseEntity {
    @Property.object({ cls: () => OrderMetadata })
    metadata!: OrderMetadata;

    @Property.oneToMany({ target: () => Shipment, inverseSide: 'order' })
    shipments!: Shipment[];
}

@Entity({ tenant: 'shared' })
class Shipment extends BaseEntity {
    @Property.string()
    tracking!: string;

    @Property.manyToOne({ target: () => Order, joinColumn: 'orderId', inverseSide: 'shipments' })
    order!: Order;

    @Property.string({ format: 'uuid' })
    orderId!: string;
}

// the values an application forwards from a request without a second thought - a search box, an id
// from a url - none of which needs a caller attacking anything
describe('PostgresTypeOrmWhereFilterConverter — JSONB SQL literal escaping', () => {
    let server: StartedTestServer;
    let contactRepo: Repository<Contact>;
    let orderRepo: Repository<Order>;
    let shipmentRepo: Repository<Shipment>;

    /**
     * Stores one order whose json column carries the given label.
     * @param label - The label.
     * @returns The order.
     */
    async function orderLabelled(label: string): Promise<Order> {
        return await orderRepo.create({ metadata: { label, 'line-items': [{ sku: 'sku-1' }] } });
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Contact, Order, Shipment], repositories: defaultTestServerRepositories })]
        });
        contactRepo = inject(repositoryTokenFor(Contact));
        orderRepo = inject(repositoryTokenFor(Order));
        shipmentRepo = inject(repositoryTokenFor(Shipment));
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    beforeEach(async () => {
        await contactRepo.deleteAll({});
        await shipmentRepo.deleteAll({});
        await orderRepo.deleteAll({});
    });

    // a placeholder that stands in for the column while the statement is assembled, substituted by
    // hand afterwards, would be substituted inside the value as well
    it('finds a row whose json value contains the placeholder the converter used for the column', async () => {
        const order: Order = await orderLabelled('$$COL$$');

        const found: Order[] = await orderRepo.findAll({ where: { metadata: { where: { label: '$$COL$$' } } } });

        expect(found.map(o => o.id)).toEqual([order.id]);
    });

    // pasted in as an identifier rather than quoted, a hyphen in the name reads as an operator
    it('filters on a json field whose name is not a bare sql identifier', async () => {
        const order: Order = await orderLabelled('kebab');

        const found: Order[] = await orderRepo.findAll({ where: { metadata: { where: { 'line-items': { where: { sku: 'sku-1' } } } } } });

        expect(found.map(o => o.id)).toEqual([order.id]);
    });

    // an id that is not a uuid the framework generated, pasted into the list unescaped, would rewrite
    // the list around it
    it('does not let an entity id decide which rows a relation filter matches', async () => {
        const order: Order = await orderLabelled('relation');
        const shipment: Shipment = await shipmentRepo.create({ tracking: 'T1', orderId: order.id });

        const found: Order[] = await orderRepo.findAll({ where: { shipments: { includes: [{ ...shipment, id: '\') OR (\'1\'=\'1' }] } } });

        expect(found).toHaveLength(0);
    });

    // bound rather than substituted, an id that is no uuid is what postgres refuses to parse, so a
    // relation filter on one has to match nothing rather than fail
    it('does not let an entity id contain the placeholder the converter used for the alias', async () => {
        const order: Order = await orderLabelled('relation');
        const shipment: Shipment = await shipmentRepo.create({ tracking: 'T1', orderId: order.id });

        const found: Order[] = await orderRepo.findAll({ where: { shipments: { includes: [{ ...shipment, id: '$alias$' }] } } });

        expect(found).toHaveLength(0);
    });

    it('matches a JSONB string value containing a single quote without a SQL syntax error', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });
        await contactRepo.create({ name: 'B', details: { lastName: 'Smith', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: 'O\'Brien' } } }
        });

        expect(res.map(c => c.name)).toEqual(['A']);
    });

    it('does not allow a quoted value to break out of the string literal and inject SQL', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });
        await contactRepo.create({ name: 'B', details: { lastName: 'Smith', note: 'ordinary' } });

        // an injection payload shaped to try to close the literal and always match everything
        const payload: string = 'x\' OR \'1\'=\'1';

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: payload } } }
        });

        // must match nothing, not silently return all rows nor throw a syntax error
        expect(res).toEqual([]);
    });

    it('rejects an unterminated quote payload safely (matches nothing, does not corrupt the query)', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: 'unterminated\'' } } }
        });

        expect(res).toEqual([]);
    });

    it('handles multiple consecutive quotes in a value correctly', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: '\'\'\'\'', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: '\'\'\'\'' } } }
        });

        expect(res.map(c => c.name)).toEqual(['A']);
    });

    it('matches via the "like" operator on a JSONB string field containing a quote', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: { like: '%O\'Brien%' } } } }
        });

        expect(res.map(c => c.name)).toEqual(['A']);
    });
});