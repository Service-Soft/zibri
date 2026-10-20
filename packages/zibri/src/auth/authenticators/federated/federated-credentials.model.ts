import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * The one-time code a sign-in at a provider is handed over with.
 */
export class FederatedHandoverCredentials {
    /**
     * The code.
     */
    @Property.string()
    code!: string;

    /**
     * The PKCE verifier whose challenge the sign-in was started with. Left out when the sign-in was
     * started without one, and the cookie it set is the proof instead.
     */
    @Property.string({ required: false })
    codeVerifier?: string;
}

/**
 * The one-time ticket a sign-in at a provider continues with when no user is linked to the identity.
 */
export class FederatedTicketCredentials {
    /**
     * The ticket.
     */
    @Property.string()
    ticket!: string;

    /**
     * The PKCE verifier whose challenge the sign-in was started with. Left out when the sign-in was
     * started without one, and the cookie it set is the proof instead.
     */
    @Property.string({ required: false })
    codeVerifier?: string;
}

/**
 * What an authenticator signing in at a provider logs in with.
 */
export type FederatedCredentials = FederatedHandoverCredentials | FederatedTicketCredentials;