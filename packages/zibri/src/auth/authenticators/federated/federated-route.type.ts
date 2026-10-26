/**
 * A route of a login at a provider whose url the authenticator gives out:
 * - `callback`: where the provider sends the browser back to with its answer. It is registered at
 * the provider exactly as the authenticator resolves it.
 * - `link-identity`: where the url `requestLinkIdentity` answers with leads, which sends the browser on to the
 * provider.
 * - `logout`: where the provider sends the browser to say the user logged out there, or that it
 * ended its session after a logout here.
 * - `logout/soap`: where the provider sends a logout request server to server, in a SOAP envelope.
 * - `logout/back-channel`: where an OpenID Connect provider sends a logout token server to server.
 */
export type FederatedRoute = 'callback' | 'link-identity' | 'logout' | 'logout/soap' | 'logout/back-channel';