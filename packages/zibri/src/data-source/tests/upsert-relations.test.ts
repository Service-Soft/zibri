import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Repository } from '../repository/repository';

@Entity({ tenant: 'shared', uniques: [['name']] })
class Warehouse extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => StockLevel, inverseSide: 'warehouse' })
    stockLevels!: StockLevel[];
}

/**
 * Every read of one resolves its warehouse, which is what makes an upsert handing back a row without
 * it a `TypeError` rather than a missing property: nothing about the type says it can be absent.
 */
@Entity({ tenant: 'shared', uniques: [['tenant', 'sku']], defaultRelations: { warehouse: true } })
class StockLevel extends BaseEntity {
    @Property.string()
    tenant!: string;

    @Property.string()
    sku!: string;

    @Property.number()
    quantity!: number;

    @Property.manyToOne({ target: () => Warehouse, inverseSide: 'stockLevels', joinColumn: 'warehouseId' })
    warehouse!: Warehouse;

    @Property.string({ format: 'uuid' })
    warehouseId!: string;
}

let server: StartedTestServer;
let warehouseRepository: Repository<Warehouse>;
let stockRepository: Repository<StockLevel>;
let warehouse: Warehouse;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Warehouse, StockLevel] })]
    });
    warehouseRepository = inject(repositoryTokenFor(Warehouse));
    stockRepository = inject(repositoryTokenFor(StockLevel));
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

beforeEach(async () => {
    await stockRepository.deleteAll({});
    await warehouseRepository.deleteAll({});
    warehouse = await warehouseRepository.create({ name: 'main' });
});

describe('upsert and relations', () => {

    it('writes a relation named in the create data as the foreign key it resolves to', async () => {
        await stockRepository.upsert(
            { tenant: 't1', sku: 'a' },
            { tenant: 't1', sku: 'a', quantity: 1, warehouse },
            { quantity: { increment: 1 } }
        );

        // postgres built one statement out of the create data and had no column to put a relation
        // in, so it threw `"StockLevel" has no property "warehouse"` - while valkey resolved the
        // same relation to its foreign key and accepted it. One create shape, two answers
        const stored: StockLevel = await stockRepository.findOne({ where: { tenant: 't1', sku: 'a' } });
        expect(stored.warehouseId).toBe(warehouse.id);
    });

    it('takes the relation as an id just as well', async () => {
        await stockRepository.upsert(
            { tenant: 't1', sku: 'b' },
            { tenant: 't1', sku: 'b', quantity: 1, warehouseId: warehouse.id },
            { quantity: { increment: 1 } }
        );

        const stored: StockLevel = await stockRepository.findOne({ where: { tenant: 't1', sku: 'b' } });
        expect(stored.warehouseId).toBe(warehouse.id);
    });

    it('hands back a row with its relations resolved, the same as every other read', async () => {
        const created: StockLevel = await stockRepository.upsert(
            { tenant: 't1', sku: 'c' },
            { tenant: 't1', sku: 'c', quantity: 1, warehouse },
            { quantity: { increment: 1 } }
        );

        // the entity declares defaultRelations, so `warehouse` is present on the result of every
        // other read and its type is not optional. It used to come back undefined from this one
        expect(created.warehouse?.name).toBe('main');
    });

    it('resolves the relations a caller asks for', async () => {
        const updated: Warehouse = await warehouseRepository.upsert(
            { name: 'main' },
            { name: 'main' },
            { name: { set: 'main' } },
            { relations: ['stockLevels'] }
        );

        expect(updated.stockLevels).toEqual([]);
    });

    it('refuses a relation that is not stored on the row being written', async () => {
        // a oneToMany lives on the rows at the other end, so writing it means writing those rows -
        // statements beside the insert-or-update, which is the window an upsert exists to close
        await expect(warehouseRepository.upsert(
            { name: 'other' },
            { name: 'other', stockLevels: [] },
            { name: { set: 'other' } }
        )).rejects.toThrow('cannot be part of an upsert');
    });

    it('still adds to what is stored rather than to what the caller read', async () => {
        for (let i: number = 0; i < 3; i++) {
            await stockRepository.upsert(
                { tenant: 't1', sku: 'd' },
                { tenant: 't1', sku: 'd', quantity: 1, warehouse },
                { quantity: { increment: 1 } }
            );
        }

        // the guard on everything above: a relation being translated must not have turned the
        // conflict path into a plain overwrite. One insert, then two increments
        const stored: StockLevel = await stockRepository.findOne({ where: { tenant: 't1', sku: 'd' } });
        expect(stored.quantity).toBe(3);
    });
});