import { type NewServiceAccountModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';
import { ZIBRI_SERVICE_ACCOUNT_LIMITS } from './service-account-limits.model';

/**
 * A service account to create, as `POST /` of the `ServiceAccountController` takes it.
 */
export class NewServiceAccount implements NewServiceAccountModel {
    /**
     * What the service account is for, such as `assistant`: lowercase letters, digits and hyphens between them, unique.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_SERVICE_ACCOUNT_LIMITS.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The platform roles it gets.
     */
    @Property.array({ items: { type: 'string' } })
    roles!: string[];

    /**
     * The tenant roles it gets through a membership in the tenant the request acts in. Empty for no membership.
     */
    @Property.array({ items: { type: 'string' } })
    tenantRoles!: string[];
}
