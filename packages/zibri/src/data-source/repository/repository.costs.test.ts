import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { Repository } from './repository.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Transaction } from '../transaction/transaction.model.ts';

/**
 * What repository writes cost, as the calls they make on the store. Compared as the list of calls
 * rather than as a number, so a call that should not be there is named in the difference.
 */

/**
 * A row of no tenant with nothing about it that costs a call.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class CostOrder extends BaseEntity {
    @Property.string()
    status!: string;
}

/**
 * A tenant's row, always handed back with the rows it holds.
 */
@Entity({ allowOrphan: true, defaultRelations: { files: true } })
class CostFolder extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => CostFile, inverseSide: 'folder' })
    files!: CostFile[];
}

/**
 * A tenant's row pointing at another row of the tenant.
 */
@Entity({ allowOrphan: true })
class CostFile extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => CostFolder, joinColumn: 'folderId', inverseSide: 'files' })
    folder!: Relation<CostFolder>;

    @Property.string({ format: 'uuid' })
    folderId!: string;
}

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CostOrder, CostFolder, CostFile],
    roundTrips
});

const tenantId: string = UUIDUtilities.generate();

let server: StartedTestServer | undefined;
let orders: Repository<CostOrder>;
let folders: Repository<CostFolder>;
let files: Repository<CostFile>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    orders = inject(dataSourceClass).getRepository(CostOrder);
    folders = inject(dataSourceClass).getRepository(CostFolder);
    files = inject(dataSourceClass).getRepository(CostFile);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

/**
 * Runs some work as the tenant of these cases, and reads the calls it made.
 * @param work - The work.
 * @returns The calls, as `Entity.method`.
 */
async function resolveCallsOf(work: () => Promise<unknown>): Promise<string[]> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    await tenants.runAs(tenantId, async () => await roundTrips.resolveCountOf(work));
    return roundTrips.trips.map(t => t.statement);
}

describe('what repository writes cost', () => {
    it('updates a row with one read and one write', async () => {
        const order: CostOrder = await orders.create({ status: 'new' });

        expect(await resolveCallsOf(async () => await orders.updateById(order.id, { status: 'sent' })))
            .toEqual(['CostOrder.find', 'CostOrder.updateAll']);
    });

    it('creates a row with the rows of its relations, and hands them back without reading them', async () => {
        expect(await resolveCallsOf(async () => await folders.create({ name: 'created', files: [{ name: 'a' }, { name: 'b' }] })))
            .toEqual(['CostFolder.insert', 'CostFile.insert']);
    });

    it('points a row at a row the same transaction wrote without reading it', async () => {
        const transaction: Transaction = inject(dataSourceClass).startTransaction();
        try {
            const calls: string[] = await resolveCallsOf(async () => {
                const folder: CostFolder = await folders.create({ name: 'written before' }, { transaction });
                roundTrips.reset();
                await files.create({ name: 'pointing', folderId: folder.id }, { transaction });
            });

            expect(calls).toEqual(['CostFile.insert']);
        }
        finally {
            await transaction.rollback();
        }
    });

    it('updates the rows of a relation given with their ids', async () => {
        const folder: CostFolder = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(tenantId, async () => await folders.create({ name: 'renamed', files: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }));

        // the files written at once, each with its own name: as many calls for three as for one
        expect(await resolveCallsOf(async () => await folders.updateById(folder.id, {
            files: folder.files.map(f => ({ id: f.id, name: `${f.name} renamed` }))
        }))).toEqual([
            'CostFolder.find',
            'CostFolder.updateAll',
            // the tenant of the rows the folder is given, and the ids of the rows its value leaves out,
            // which a delete that hands nothing back needs nothing else of
            'CostFile.find',
            'CostFile.findIds',
            'CostFile.updateEach',
            // the folder handed back with its files, which rows it was not given may still be among
            'CostFolder.findOne'
        ]);
        expect(new Set((await folders.findById(folder.id, { acrossTenants: true })).files.map(f => f.name)))
            .toEqual(new Set(['a renamed', 'b renamed', 'c renamed']));
    });

    it('reads a row it points at that the transaction did not write', async () => {
        const folder: CostFolder = await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
            .runAs(tenantId, async () => await folders.create({ name: 'stored before' }));

        expect(await resolveCallsOf(async () => await files.create({ name: 'pointing', folderId: folder.id })))
            .toEqual(['CostFolder.find', 'CostFile.insert']);
    });
});