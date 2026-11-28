import { type DeepPartial } from '../../types/deep-partial.type';
import { type OmitStrict } from '../../types/omit-strict.type';
import { type BaseUser } from '../models/base-user.model';

/**
 * What a service account is created with: its `name`, its platform `roles`, and the values of any further columns
 * the user entity requires. Its email is made of the name, see `createServiceAccount` of the user service, and its
 * kind is `'service'`.
 */
export type ServiceAccountCreateData<UserType extends BaseUser<string>> = OmitStrict<
    DeepPartial<UserType>,
    'id' | 'email' | 'roles' | 'kind' | 'emailVerifiedAt' | 'deactivatedAt' | 'locale'
> & {
    /**
     * What the service account is for, such as `billing`: lowercase letters, digits and hyphens between them. Its
     * email is `<name>@service-accounts.invalid`, so two service accounts of one name cannot exist.
     */
    name: string,
    /**
     * The platform roles of the service account. The tenants it works in are memberships of its own.
     */
    roles: UserType['roles']
};
