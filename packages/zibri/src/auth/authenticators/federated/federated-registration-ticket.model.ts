import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import type { HashString } from '../../hash/hash.utilities.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';

/**
 * A sign-in at a provider whose identity no user is linked to yet.
 *
 * Read while the user is created, and spent once by the login that follows - by the browser the
 * sign-in was started in or by the frontend holding the PKCE verifier.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class FederatedRegistrationTicket extends BaseEntity {
    /**
     * The ticket.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The name of the authenticator the sign-in went through.
     */
    @Property.string()
    provider!: string;

    /**
     * The issuer the provider's identities are known by.
     */
    @Property.string()
    issuer!: string;

    /**
     * Who signed in at the provider, as the provider names them.
     */
    @Property.string()
    subject!: string;

    /**
     * The email the provider reports.
     */
    @Property.string({ required: false })
    email: string | undefined | null;

    /**
     * Whether the provider has verified that email.
     */
    @Property.boolean({ required: false })
    emailVerified: boolean | undefined | null;

    /**
     * The full name the provider reports.
     */
    @Property.string({ required: false })
    name: string | undefined | null;

    /**
     * The given name the provider reports.
     */
    @Property.string({ required: false })
    givenName: string | undefined | null;

    /**
     * The family name the provider reports.
     */
    @Property.string({ required: false })
    familyName: string | undefined | null;

    /**
     * Where the sign-in was to go once it was done.
     */
    @Property.string()
    redirectTo!: string;

    /**
     * When the user signed in at the provider.
     */
    @Property.date()
    authenticatedAt!: Date;

    /**
     * Identifies the person at the provider, for the login to keep. Null when the provider names no
     * session that can be ended.
     */
    @Property.string({ required: false })
    subjectKey: string | undefined | null;

    /**
     * Identifies their session at the provider, for the login to keep. Null when the provider names none.
     */
    @Property.string({ required: false })
    sessionKey: string | undefined | null;

    /**
     * What ends the session at the provider, for the login to keep. Null when the provider cannot be told.
     */
    @Property.string({ required: false })
    sessionLogout: string | undefined | null;

    /**
     * The secret of the cookie the ticket can be spent with. Null when it is spent with a PKCE verifier.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy }, required: false })
    binding: HashString | undefined | null;

    /**
     * The name of that cookie.
     */
    @Property.string({ required: false })
    bindingCookie: string | undefined | null;

    /**
     * The PKCE challenge whose verifier the ticket can be spent with. Null when it is spent with a cookie.
     */
    @Property.string({ required: false })
    codeChallenge: string | undefined | null;

    /**
     * The access token the provider issued, when the sign-in asked for access to its apis. Kept for the
     * identity once it is linked.
     */
    @Property.string({ encryption: true, required: false })
    accessToken: string | undefined | null;

    /**
     * The refresh token the provider issued with it, if any.
     */
    @Property.string({ encryption: true, required: false })
    refreshToken: string | undefined | null;

    /**
     * When the access token stops being accepted, if the provider said.
     */
    @Property.date({ required: false })
    accessTokenExpirationDate: Date | undefined | null;

    /**
     * The scopes the provider granted those tokens. Empty when no tokens are kept.
     */
    @Property.array({ items: { type: 'string' } })
    grantedScopes!: string[];

    /**
     * Whether the ticket has been spent.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * When the ticket stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a registration ticket.
 */
export class FederatedRegistrationTicketCreateData extends OmitClass(FederatedRegistrationTicket, ['id', 'value', 'binding']) {
    /**
     * The ticket, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;

    /**
     * The secret of the cookie, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy }, required: false })
    binding: string | undefined | null;
}