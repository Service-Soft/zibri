import { type BaseTenantDefinition } from '../../tenancy/tenant-definition/base-tenant-definition.model';
import { TsxEmailComponent } from '../../tsx/tsx-email-component.model';
import { BaseInvitation } from './base-invitation.model';

/**
 * Properties of the email an invitation is sent in.
 */
export type InvitationEmailTemplateProps = {
    /**
     * The link the invited person follows to accept or decline it.
     */
    link: string,
    /**
     * The invitation, with the columns of your own it was sent with.
     */
    invitation: BaseInvitation,
    /**
     * The tenant the invitation is to, read from the entity of the tenants, such as for its name. Undefined for an
     * invitation to the application, and without an entity of the tenants.
     */
    tenant: BaseTenantDefinition | undefined
};

/**
 * Definition for the email an invitation is sent in.
 */
export type InvitationEmailTemplate = TsxEmailComponent<InvitationEmailTemplateProps>;