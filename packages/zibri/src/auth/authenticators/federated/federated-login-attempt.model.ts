import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * A login at a provider that has been started and not yet come back.
 */
@Entity({ tenant: 'shared', allowOrphan: true, expiresBy: 'expirationDate' })
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
     * Where the login goes once it is done.
     */
    @Property.string()
    redirectTo!: string;

    /**
     * Whether the provider was asked to have the user log in again, even when it still had a session of theirs.
     */
    @Property.boolean()
    reauthenticate!: boolean;

    /**
     * The PKCE challenge of the frontend the login is handed to, which only the holder of its verifier
     * can take the login with. Null when the login logs in on the redirect back from the provider.
     */
    @Property.string({ required: false })
    codeChallenge: string | undefined | null;

    /**
     * The name of the auth strategy the login logs in with on the redirect back from the provider.
     * Null when the login is handed over by code, and for a connection.
     */
    @Property.string({ required: false })
    strategy: string | undefined | null;

    /**
     * The user the identity is linked to, when the login connects the provider to their account.
     * Null for a login.
     */
    @Property.string({ format: 'uuid', required: false })
    userId: string | undefined | null;

    /**
     * Whether the identity logs in as the user. Always true for a login.
     */
    @Property.boolean()
    forLogin!: boolean;

    /**
     * The scopes of the provider's apis the login asks for on top of the authenticator's own, whose
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