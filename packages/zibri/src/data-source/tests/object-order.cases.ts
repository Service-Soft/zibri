import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';

/**
 * Where a shipment goes, nested inside its address.
 */
export class ShipmentRegion {
    /**
     * The number of the region, which sorts differently as a number than as a text.
     */
    @Property.number({ format: 'integer' })
    code!: number;
}

/**
 * The address of a shipment, stored inside the shipment's json value.
 */
export class ShipmentAddress {
    /**
     * The city.
     */
    @Property.string()
    city!: string;

    /**
     * The house number, which sorts differently as a number than as a text.
     */
    @Property.number({ format: 'integer' })
    number!: number;

    /**
     * When the address can take a delivery from.
     */
    @Property.date()
    reachableFrom!: Date;

    /**
     * The region of the address.
     */
    @Property.object({ cls: () => ShipmentRegion })
    region!: ShipmentRegion;
}

/**
 * A shipment, read in the order of its address.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Shipment extends BaseEntity {
    /**
     * What the cases name the shipment by.
     */
    @Property.string()
    label!: string;

    /**
     * Where it goes.
     */
    @Property.object({ cls: () => ShipmentAddress })
    address!: ShipmentAddress;
}

/**
 * Runs the cases about ordering by the properties of an object against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSourceOf - Reads the data source, once it is started.
 */
export function describeObjectOrder(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`ordering by the properties of an object on ${dataSourceName}`, () => {
        let shipments: Repository<Shipment>;

        beforeEach(async () => {
            shipments = dataSourceOf().getRepository(Shipment);
            await shipments.deleteAll({});
            await shipments.createAll([
                { label: 'a', address: { city: 'Hamburg', number: 9, reachableFrom: new Date('2026-03-01'), region: { code: 100 } } },
                { label: 'b', address: { city: 'Berlin', number: 100, reachableFrom: new Date('2026-01-01'), region: { code: 9 } } },
                { label: 'c', address: { city: 'Berlin', number: 10, reachableFrom: new Date('2026-02-01'), region: { code: 10 } } }
            ]);
        }, 30000);

        it('orders by a number inside an object as a number, both ways', async () => {
            const ascending: Shipment[] = await shipments.findAll({ order: { address: { number: 'ASC' } } });
            const descending: Shipment[] = await shipments.findAll({ order: { address: { number: 'DESC' } } });

            expect(ascending.map(s => s.label)).toEqual(['a', 'c', 'b']);
            expect(descending.map(s => s.label)).toEqual(['b', 'c', 'a']);
        }, 30000);

        it('orders by a date inside an object', async () => {
            const ordered: Shipment[] = await shipments.findAll({ order: { address: { reachableFrom: 'ASC' } } });

            expect(ordered.map(s => s.label)).toEqual(['b', 'c', 'a']);
        }, 30000);

        it('orders by a property of an object inside an object', async () => {
            const ordered: Shipment[] = await shipments.findAll({ order: { address: { region: { code: 'ASC' } } } });

            expect(ordered.map(s => s.label)).toEqual(['b', 'c', 'a']);
        }, 30000);

        it('leaves what a property inside an object ties on to the keys after it', async () => {
            const ordered: Shipment[] = await shipments.findAll({ order: { address: { city: 'ASC' }, label: 'DESC' } });

            expect(ordered.map(s => s.label)).toEqual(['c', 'b', 'a']);
        }, 30000);

        it('orders a page by a property inside an object', async () => {
            const page: Shipment[] = await shipments.findAll({ order: { address: { number: 'DESC' } }, limit: 2 });

            expect(page.map(s => s.label)).toEqual(['b', 'c']);
        }, 30000);
    });
}