import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import type { HashString } from '../../hash/hash.utilities.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';

/**
 * A sign-in at a provider that has been proven and not yet turned into a login.
 *
 * Spent once, by the browser the sign-in was started in or by the frontend holding the PKCE verifier.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class FederatedHandoverCode extends BaseEntity {
    /**
     * The code.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The name of the authenticator the sign-in went through.
     */
    @Property.string()
    provider!: string;

    /**
     * The user that signed in.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

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
     * The secret of the cookie the code can be spent with. Null when it is spent with a PKCE verifier.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy }, required: false })
    binding: HashString | undefined | null;

    /**
     * The name of that cookie.
     */
    @Property.string({ required: false })
    bindingCookie: string | undefined | null;

    /**
     * The PKCE challenge whose verifier the code can be spent with. Null when it is spent with a cookie.
     */
    @Property.string({ required: false })
    codeChallenge: string | undefined | null;

    /**
     * Whether the code has been spent.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * When the code stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a handover code.
 */
export class FederatedHandoverCodeCreateData extends OmitClass(FederatedHandoverCode, ['id', 'value', 'binding']) {
    /**
     * The code, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;

    /**
     * The secret of the cookie, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy }, required: false })
    binding: string | undefined | null;
}