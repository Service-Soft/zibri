import { AuthorizationServerControllerClass } from './authorization-server-controller-class.type.ts';
import { AuthorizationServerControllerOptions } from './authorization-server-controller-options.model.ts';
import { AuthorizationServerEndpoint } from './authorization-server-endpoint.model.ts';
import { type AuthorizationServerServiceInterface } from './authorization-server-service.interface.ts';
import { IntrospectionResponse } from './introspection-response.model.ts';
import { TokenPresentation } from './token-presentation.model.ts';
import { TokenRequest } from './token-request.model.ts';
import { TokenResponse } from './token-response.model.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { JsonResponse } from '../../http/json-response.model.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { Response } from '../../open-api/decorators/response.decorator.ts';
import { RateLimited } from '../../rate-limiting/decorators/rate-limited.decorator.ts';
import { ControllerUtilities } from '../../routing/controller.utilities.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Param } from '../../routing/decorators/param.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { Auth } from '../decorators/auth.decorator.ts';

/**
 * What a response holding a token, or what one says, carries besides its body: no cache in between
 * may keep it (RFC 6749, 5.1).
 */
const NO_STORE_HEADERS: Record<string, string> = { [KnownHeader.CACHE_CONTROL]: 'no-store', [KnownHeader.PRAGMA]: 'no-cache' };

// eslint-disable-next-line jsdoc-js/require-returns
/**
 * Defines the routes of an OAuth2 authorization server below the path of the controller that extends
 * it: `/token`, where a client exchanges its api key for an access token (RFC 6749, 4.4), `/introspect`,
 * where a resource server asks whether a token is active (RFC 7662), and `/revoke`, where a token is
 * revoked (RFC 7009). What the server is and where its routes are is published at
 * `/.well-known/oauth-authorization-server` (RFC 8414).
 * @param options - Who may introspect, and the services tokens may be issued for besides the application.
 */
export function AuthorizationServerController<RoleType extends string>(
    options: AuthorizationServerControllerOptions<RoleType>
): AuthorizationServerControllerClass {
    // every route authenticates its caller itself, the way OAuth2 says: a client by its credentials,
    // and a revocation by the token it holds. `allowRedundant` for the reason AuthController gives
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Auth.skip({ allowRedundant: true })
    class Temp {
        /**
         * What the routes allow, which also marks the class as the authorization server's.
         */
        static readonly authorizationServerOptions: AuthorizationServerControllerOptions<RoleType> = options;

        private get authorizationServerService(): AuthorizationServerServiceInterface {
            return inject(ZIBRI_DI_TOKENS.AUTHORIZATION_SERVER_SERVICE);
        }

        /**
         * Where the routes answer: below the application's `baseUrl`, followed by the path of the
         * controller extending this one.
         * @returns The routes, and what they allow.
         */
        static resolveEndpoint(this: Newable<object>): AuthorizationServerEndpoint {
            return toEndpoint(this, options);
        }

        private get endpoint(): AuthorizationServerEndpoint {
            return toEndpoint(this.constructor, options);
        }

        // eslint-disable-next-line jsdoc-js/require-jsdoc
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.object(TokenResponse)
        @Post('/token')
        async token(
            // optional, like every field of it, so that what is missing is answered the way OAuth2 says
            @Body(TokenRequest, { type: MimeType.FORM_URL_ENCODED, allowAdditionalProperties: true, required: false })
            request: TokenRequest | undefined,
            @Param.header(KnownHeader.AUTHORIZATION, { type: 'string', required: false })
            authorization: string | undefined
        ): Promise<JsonResponse<TokenResponse>> {
            const response: TokenResponse = await this.authorizationServerService.issueToken(this.endpoint, request ?? {}, authorization);
            return JsonResponse.of(response, { headers: NO_STORE_HEADERS });
        }

        // not rate limited like the routes that authenticate a client for the first time: a resource
        // server asks for every request it is sent, and it authenticates before anything is answered
        // eslint-disable-next-line jsdoc-js/require-jsdoc
        @Response.object(IntrospectionResponse)
        @Post('/introspect')
        async introspect(
            @Body(TokenPresentation, { type: MimeType.FORM_URL_ENCODED, allowAdditionalProperties: true, required: false })
            presentation: TokenPresentation | undefined,
            @Param.header(KnownHeader.AUTHORIZATION, { type: 'string', required: false })
            authorization: string | undefined
        ): Promise<JsonResponse<IntrospectionResponse>> {
            const response: IntrospectionResponse = await this.authorizationServerService.introspect(
                this.endpoint,
                presentation ?? {},
                authorization
            );
            return JsonResponse.of(response, { headers: NO_STORE_HEADERS });
        }

        // eslint-disable-next-line jsdoc-js/require-jsdoc
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.empty({ status: HttpStatus.OK, mimeTypes: [MimeType.JSON] })
        @Post('/revoke')
        async revoke(
            @Body(TokenPresentation, { type: MimeType.FORM_URL_ENCODED, allowAdditionalProperties: true, required: false })
            presentation: TokenPresentation | undefined,
            @Param.header(KnownHeader.AUTHORIZATION, { type: 'string', required: false })
            authorization: string | undefined
        ): Promise<void> {
            await this.authorizationServerService.revoke(this.endpoint, presentation ?? {}, authorization);
        }
    }
    return Temp;
}

/**
 * Where the routes of a controller answer: below the application's `baseUrl`, followed by the path of
 * the controller.
 * @param controller - The controller extending the one `AuthorizationServerController` defined.
 * @param options - What its routes allow.
 * @returns The routes, and what they allow.
 * @throws When the application has no `baseUrl` yet.
 */
function toEndpoint<RoleType extends string>(
    controller: Function,
    options: AuthorizationServerControllerOptions<RoleType>
): AuthorizationServerEndpoint {
    const baseUrl: string | undefined = GlobalRegistry.getAppData('baseUrl');
    if (baseUrl == undefined) {
        throw new InternalError('The issuer of the authorization server is the baseUrl of the application, which is not set.');
    }
    return {
        issuer: baseUrl.replace(/\/+$/, ''),
        url: ControllerUtilities.resolveUrl(controller),
        introspectionRoles: options.introspectionRoles,
        resources: options.resources
    };
}

/**
 * Checks whether a controller class was defined by `AuthorizationServerController`.
 * @param value - The class.
 * @returns True when it was.
 */
export function isAuthorizationServerControllerClass(value: unknown): value is AuthorizationServerControllerClass {
    return typeof value === 'function'
        && 'authorizationServerOptions' in value
        && 'resolveEndpoint' in value
        && typeof value.resolveEndpoint === 'function';
}