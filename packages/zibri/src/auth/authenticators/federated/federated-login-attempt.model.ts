import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import type { HashString } from '../../hash/hash.utilities.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';

/**
 * A sign-in at a provider that has been started and not yet come back.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class FederatedLoginAttempt extends BaseEntity {
    /**
     * What the provider hands back to find this attempt again: the `state` of OAuth, the `RelayState`
     * of SAML.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    state!: HashString;

    /**
     * The secret of the cookie that ties the attempt to the browser it was started in.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    binding!: HashString;

    /**
     * The name of the authenticator the attempt was started with.
     */
    @Property.string()
    provider!: string;

    /**
     * Where the sign-in goes once it is done.
     */
    @Property.string()
    redirectTo!: string;

    /**
     * Whether the provider was asked to have the user sign in again, rather than reuse its session.
     */
    @Property.boolean()
    reauthenticate!: boolean;

    /**
     * The PKCE challenge of the frontend the login is handed to, which only the holder of its verifier
     * can take the login with. Null when the sign-in logs in on the redirect back from the provider.
     */
    @Property.string({ required: false })
    codeChallenge: string | undefined | null;

    /**
     * The name of the auth strategy the sign-in logs in with on the redirect back from the provider.
     * Null when the login is handed over by code, and for a connection.
     */
    @Property.string({ required: false })
    strategy: string | undefined | null;

    /**
     * The user the identity is linked to, when the sign-in connects the provider to their account
     * rather than logging in. Null for a login.
     */
    @Property.string({ format: 'uuid', required: false })
    userId: string | undefined | null;

    /**
     * Whether the identity signs in as the user. Always true for a login.
     */
    @Property.boolean()
    signIn!: boolean;

    /**
     * The scopes of the provider's apis the sign-in asks for on top of the authenticator's own, whose
     * tokens are kept. Empty when none are.
     */
    @Property.array({ items: { type: 'string' } })
    apiScopes!: string[];

    /**
     * Whether the provider's answer has been taken already.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * When the attempt stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a login attempt.
 */
export class FederatedLoginAttemptCreateData extends OmitClass(FederatedLoginAttempt, ['id', 'state', 'binding']) {
    /**
     * The state, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    state!: string;

    /**
     * The secret of the cookie, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    binding!: string;
}