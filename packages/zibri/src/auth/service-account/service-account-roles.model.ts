import { type ServiceAccountRolesModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * The roles a service account holds from now on, as `PUT /:serviceAccountId/roles` of the `ServiceAccountController`
 * takes them.
 */
export class ServiceAccountRoles implements ServiceAccountRolesModel {
    /**
     * Its platform roles.
     */
    @Property.array({ items: { type: 'string' } })
    roles!: string[];

    /**
     * Its tenant roles in the tenant the request acts in.
     */
    @Property.array({ items: { type: 'string' } })
    tenantRoles!: string[];
}