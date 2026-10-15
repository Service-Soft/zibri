import { ScimGroupResource } from './scim-group-resource.model';
import { ScimUserResource } from './scim-user-resource.model';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { BaseMembership } from '../../tenancy/membership/base-membership.model';
import { BaseUser } from '../models/base-user.model';

/**
 * What the provisioning of a tenant's identity provider through SCIM does to the users of the
 * application.
 *
 * Extend it once, and hand it to `ScimController`. The framework keeps the SCIM resources of each
 * tenant, links each provisioned user to a user of the application, gives them a membership in the
 * tenant, and deactivates a user the identity provider sets inactive. The hooks decide what a
 * provisioned user is in the application: who they are, what changes when the identity provider
 * changes them, what their groups make of their roles in the tenant, and what deleting them means.
 *
 * A user the identity provider creates is owned by its tenant: its identity provider changes,
 * deactivates and deletes them in every tenant. A user it finds, who existed already, is only a
 * member of its tenant: its identity provider reaches that membership and nothing else.
 */
export abstract class BaseScimProvisioner<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>,
    MembershipType extends BaseMembership<RoleType> = BaseMembership<RoleType>
> {
    /**
     * Finds the existing user a newly provisioned resource stands for, such as by their email. The
     * user becomes a member of the tenant, and nothing else about them is the identity provider's to
     * change. Throw an http error to refuse the resource.
     * @param resource - The resource.
     * @param transaction - The transaction it is provisioned in.
     * @returns The user, or undefined to have one created through `createProvisionedUser`.
     */
    abstract findProvisionedUser(resource: ScimUserResource, transaction: Transaction): Promise<UserType | undefined>;

    /**
     * Creates the user a newly provisioned resource stands for, when `findProvisionedUser` found
     * none. The tenant becomes the user's owner. Throw an http error to refuse the resource.
     * @param resource - The resource.
     * @param transaction - The transaction it is provisioned in.
     * @returns The user.
     */
    abstract createProvisionedUser(resource: ScimUserResource, transaction: Transaction): Promise<UserType>;

    /**
     * Changes a user the tenant owns after the identity provider changed their resource, such as their
     * email address. Whether they are active is the framework's to apply.
     * @param resource - The resource, as it is now.
     * @param user - The user it stands for.
     * @param transaction - The transaction it is changed in.
     */
    abstract resolveUpdatedUser(resource: ScimUserResource, user: UserType, transaction: Transaction): Promise<void>;

    /**
     * Changes the membership of a user in the tenant after the groups they are a member of changed,
     * such as their roles there. Also called once they are provisioned, with the groups they are in
     * then.
     * @param membership - The membership of the user in the tenant.
     * @param groups - Every group they are a member of now, directly or through groups that are
     * members of others.
     * @param transaction - The transaction the groups are changed in.
     */
    abstract resolveGroupMembership(membership: MembershipType, groups: ScimGroupResource[], transaction: Transaction): Promise<void>;

    /**
     * Deletes a user the tenant owns after the identity provider deleted them, or keeps them
     * deactivated and anonymized. They are deactivated already, so they cannot log in either way, and
     * their membership in the tenant is deleted.
     * @param user - The user.
     * @param transaction - The transaction they are deleted in.
     */
    abstract resolveDeletedUser(user: UserType, transaction: Transaction): Promise<void>;
}