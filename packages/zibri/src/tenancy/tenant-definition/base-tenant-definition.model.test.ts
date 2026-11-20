import { describe, expect, it } from '@jest/globals';

import { FrameworkColumnRegistry } from '../../data-source/migration/framework-column.registry';
import { Entity } from '../../entity/decorators/entity.decorator';
import { keyGroupsOf } from '../../global/model-registry/key-descriptor';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BaseTenantDefinitionEntity, TENANT_ENTITY } from './base-tenant-definition.model';

/**
 * The tenants as `zi new` writes them: deactivatable, with a name that is unique.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['name']] })
class NamedTenant extends BaseTenantDefinitionEntity({ deactivatable: true }) {}

/**
 * Tenants that cannot be deactivated.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class PlainTenant extends BaseTenantDefinitionEntity() {}

describe('BaseTenantDefinitionEntity', () => {
    it('marks the entity of the tenants, and adds deactivatedAt only when it is deactivatable', () => {
        expect(TENANT_ENTITY in NamedTenant).toBe(true);
        expect(TENANT_ENTITY in PlainTenant).toBe(true);
        expect(Object.keys(MetadataUtilities.getModelProperties(NamedTenant)).sort()).toEqual(['deactivatedAt', 'id', 'name']);
        expect(Object.keys(MetadataUtilities.getModelProperties(PlainTenant)).sort()).toEqual(['id', 'name']);
    });

    // what the Tenant of 3.1, whose name was declared unique, holds as well, so its table stays as it is
    it('keeps a name unique the entity declares so', () => {
        expect(keyGroupsOf(NamedTenant).uniques).toEqual([expect.objectContaining({ properties: ['name'] })]);
        expect(keyGroupsOf(PlainTenant).uniques).toEqual([]);
    });

    it('adds deactivatedAt to a table that lacks it as a column of the framework, which takes no migration', () => {
        expect(FrameworkColumnRegistry.getAll().some(column => column.property === 'deactivatedAt'
            && NamedTenant.prototype instanceof column.entity)).toBe(true);
        expect(FrameworkColumnRegistry.getAll().some(column => PlainTenant.prototype instanceof column.entity)).toBe(false);
    });
});