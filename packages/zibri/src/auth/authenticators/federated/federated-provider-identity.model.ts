import { FederatedProfile } from './federated-profile.model';

/**
 * Who signed in at a provider, as its answer to a sign-in proves.
 */
export type FederatedProviderIdentity = {
    /**
     * The issuer the provider's identities are known by.
     */
    issuer: string,
    /**
     * Who signed in, as the provider names them.
     */
    subject: string,
    /**
     * When they signed in at the provider.
     */
    authenticatedAt: Date,
    /**
     * What the provider reports about them.
     */
    profile: FederatedProfile
};