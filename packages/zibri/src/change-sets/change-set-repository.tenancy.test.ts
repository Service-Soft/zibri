import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ChangeSetEntity } from './models/change-set-entity.model';
import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../utilities/uuid.utilities';

@Entity({ allowOrphan: true })
class TenantGadget extends BaseEntity implements ChangeSetEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' })
    changeSets!: ChangeSet[];
}

// in memory, so that what a change set does across tenants can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, TenantGadget]
});

describe('ChangeSetRepository across tenants', () => {
    const tenantA: string = UUIDUtilities.generate();
    const tenantB: string = UUIDUtilities.generate();

    let server: StartedTestServer;
    let tenants: TenantServiceInterface;
    let gadgets: Repository<TenantGadget>;
    let changeSets: Repository<ChangeSet, CreateChangeSetData>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        gadgets = inject(repositoryTokenFor(TenantGadget));
        changeSets = inject(repositoryTokenFor(ChangeSet));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('records each change in the tenant of the row it describes, also when the write reached across tenants', async () => {
        const gadget: TenantGadget = await tenants.runAs(tenantA, async () => await gadgets.create({ name: 'first' }));
        // from outside every tenant: the record of the change still belongs to the row's tenant
        await gadgets.updateById(gadget.id, { name: 'second' }, { acrossTenants: true });

        const recorded: ChangeSet[] = await changeSets.findAll({ where: { changeSetEntityId: gadget.id }, acrossTenants: true });
        expect(recorded.map(c => [c.type, c.tenantId])).toEqual([
            [ChangeSetType.CREATE, tenantA],
            [ChangeSetType.UPDATE, tenantA]
        ]);
        expect(recorded.flatMap(c => c.changes).map(c => c.tenantId)).toEqual(recorded.flatMap(c => c.changes).map(() => tenantA));

        // the history of a tenant's row is that tenant's
        await tenants.runAs(tenantB, async () => {
            expect(await changeSets.findAll({ where: { changeSetEntityId: gadget.id } })).toEqual([]);
        });
        await tenants.runAs(tenantA, async () => {
            expect(await changeSets.count({ where: { changeSetEntityId: gadget.id } })).toBe(2);
        });
    });
});