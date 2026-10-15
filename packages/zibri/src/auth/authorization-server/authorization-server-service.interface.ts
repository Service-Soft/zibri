import { AuthorizationServerEndpoint } from './authorization-server-endpoint.model';
import { IntrospectionResponse } from './introspection-response.model';
import { TokenPresentation } from './token-presentation.model';
import { TokenRequest } from './token-request.model';
import { TokenResponse } from './token-response.model';

/**
 * Interface for the service answering the routes of the authorization server.
 */
export interface AuthorizationServerServiceInterface {
    /**
     * Issues an access token to a client that authenticates with its api key (RFC 6749, 4.4). Throws
     * an OAuth2Error saying why when it does not.
     */
    issueToken: (endpoint: AuthorizationServerEndpoint, request: TokenRequest, authorization: string | undefined) => Promise<TokenResponse>,
    /**
     * Answers whether a token is active, and what it says (RFC 7662), to a caller holding one of the
     * introspection roles.
     */
    introspect: (
        endpoint: AuthorizationServerEndpoint,
        presentation: TokenPresentation,
        authorization: string | undefined
    ) => Promise<IntrospectionResponse>,
    /**
     * Revokes a token (RFC 7009). A token that is not one changes nothing.
     */
    revoke: (endpoint: AuthorizationServerEndpoint, presentation: TokenPresentation, authorization: string | undefined) => Promise<void>
}