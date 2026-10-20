import { FakeOAuthProviderOptions } from './fake-oauth-provider-options.model.ts';
import { FakeOAuthProvider } from './fake-oauth-provider.model.ts';

/**
 * Starts a provider in the test's own process, reached over plain http on the loopback interface. It
 * speaks OpenID Connect, or plain OAuth2 when it issues no ID tokens.
 * @param options - The client it knows, and how it answers.
 * @returns The started provider, which the test is responsible for stopping.
 */
export async function startFakeOAuthProvider(options: FakeOAuthProviderOptions): Promise<FakeOAuthProvider> {
    const provider: FakeOAuthProvider = new FakeOAuthProvider(options);
    await provider.listen();
    return provider;
}