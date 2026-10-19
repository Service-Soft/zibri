/**
 * A route of a sign-in at a provider whose url the authenticator gives out:
 * - `callback`: where the provider sends the browser back to with its answer. It is registered at
 * the provider exactly as the authenticator resolves it.
 * - `connect`: where the url `startConnection` answers with leads, which sends the browser on to the provider.
 * - `logout`: where the provider sends the browser to say the user logged out there, or that it
 * ended its session after a logout here.
 * - `logout/soap`: where the provider sends a logout request server to server, in a SOAP envelope.
 */
export type FederatedRoute = 'callback' | 'connect' | 'logout' | 'logout/soap';