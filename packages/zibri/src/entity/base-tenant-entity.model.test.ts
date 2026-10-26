import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { BaseEntity } from './base-entity.model';
import { BaseTenantEntity } from './base-tenant-entity.model';
import { Entity } from './decorators/entity.decorator';
import { Property } from './decorators/property.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { ChangeSetEntity } from '../data-source/change-sets/models/change-set-entity.model';
import { isChangeSetEntityNewable } from '../data-source/change-sets/models/is-change-set-entity.function';
import { isSoftDeleteEntityNewable } from '../data-source/change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../data-source/change-sets/models/soft-delete-entity.model';
import { RepositoryTypeForEntity } from '../data-source/data-sources/data-source.interface';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { UUIDUtilities } from '../utilities/uuid.utilities';

@Entity({ allowOrphan: true })
class Note extends BaseTenantEntity() {
    @Property.string()
    title!: string;
}

/**
 * A note per tenant that soft deletes, declared through the base alone: the tenant base extended
 * `BaseEntity`, so an entity that soft deleted declared `tenantId` itself (08 §X28).
 */
@Entity()
class ArchivedNote extends BaseTenantEntity(SoftDeleteEntity) {
    @Property.string()
    title!: string;
}

@Entity({ allowOrphan: true })
class TrackedNote extends BaseTenantEntity(ChangeSetEntity) {
    @Property.string()
    title!: string;
}

describe('BaseTenantEntity', () => {

    it('extends the base it is given, with the tenant of each row', () => {
        const note: ArchivedNote = new ArchivedNote();
        // typed as the base and as a row of a tenant both
        const deleted: boolean | undefined = note.deleted;
        const tenantId: string | undefined = note.tenantId;

        expect({ deleted, tenantId }).toEqual({ deleted: undefined, tenantId: undefined });
        expect(new Note()).toBeInstanceOf(BaseEntity);
        expect(isChangeSetEntityNewable(Note)).toBe(false);
        expect(isSoftDeleteEntityNewable(ArchivedNote)).toBe(true);
        expect(isChangeSetEntityNewable(TrackedNote)).toBe(true);
        expect(isSoftDeleteEntityNewable(TrackedNote)).toBe(false);
    });

    describe('soft deleting, on a data source', () => {
        let server: StartedTestServer | undefined;
        let notes: RepositoryTypeForEntity<ArchivedNote>;
        let tenantService: TenantServiceInterface;
        const tenantId: string = UUIDUtilities.generate();

        beforeAll(async () => {
            server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: [ArchivedNote] })] });
            notes = inject(repositoryTokenFor(ArchivedNote));
            tenantService = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('keeps a soft deleted row in the tenant it was written in', async () => {
            await tenantService.runAs(tenantId, async () => {
                const note: ArchivedNote = await notes.create({ title: 'Release notes' });
                await notes.deleteById(note.id);

                expect(await notes.findAll()).toEqual([]);
                const [deleted] = await notes.findAll({ deleted: 'only' });
                expect({ title: deleted?.title, tenantId: deleted?.tenantId }).toEqual({ title: 'Release notes', tenantId });
            });
            const elsewhere: ArchivedNote[] = await tenantService.runAs(UUIDUtilities.generate(), async () => await notes.findAll({ deleted: 'only' }));
            expect(elsewhere).toEqual([]);
        });
    });
});
