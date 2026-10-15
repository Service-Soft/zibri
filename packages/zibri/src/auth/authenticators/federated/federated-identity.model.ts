import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';

/**
 * An identity at a provider, linked to a user: to sign in as them, to call the provider's apis for
 * them, or both.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['issuer', 'subject']] })
export class FederatedIdentity extends BaseEntity {
    /**
     * The issuer the provider's identities are known by: the `iss` of an OpenID Connect provider's ID
     * tokens, the entity id of a SAML identity provider, or the one its authenticator names.
     */
    @Property.string()
    issuer!: string;

    /**
     * Who the identity is at the provider, as the provider names them.
     */
    @Property.string()
    subject!: string;

    /**
     * The user the identity is linked to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * Whether a sign-in through the provider logs in as the user. False for an identity connected only
     * for access to the provider's apis.
     */
    @Property.boolean()
    signIn!: boolean;

    /**
     * The scopes the provider granted the tokens that are kept for the identity, for calling its apis.
     * Empty when no tokens are kept.
     */
    @Property.array({ items: { type: 'string' } })
    grantedScopes!: string[];
}

/**
 * The data to create a linked identity.
 */
export class FederatedIdentityCreateData extends OmitClass(FederatedIdentity, ['id']) {}