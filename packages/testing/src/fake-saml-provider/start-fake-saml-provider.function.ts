import { FakeSamlProviderOptions } from './fake-saml-provider-options.model';
import { FakeSamlProvider } from './fake-saml-provider.model';

/**
 * Starts a SAML 2.0 identity provider in the test's own process, reached over plain http on the
 * loopback interface.
 * @param options - The service provider it knows, and how it answers.
 * @returns The started provider, which the test is responsible for stopping.
 */
export async function startFakeSamlProvider(options: FakeSamlProviderOptions): Promise<FakeSamlProvider> {
    const provider: FakeSamlProvider = await FakeSamlProvider.create(options);
    await provider.listen();
    return provider;
}