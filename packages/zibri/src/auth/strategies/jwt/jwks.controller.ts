import { Jwk } from './jwk.model';
import { Jwks } from './jwks.model';
import { type JwtServiceInterface } from './jwt-service.interface';
import { JwtUtilities } from './jwt.utilities';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { InternalError } from '../../../error-handling/internal-error.model';
import { Response } from '../../../open-api/decorators/response.decorator';
import { Route } from '../../../routing/controller-route-configuration.model';
import { ControllerUtilities } from '../../../routing/controller.utilities';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Newable } from '../../../types/newable.type';
import { Auth } from '../../decorators/auth.decorator';

/**
 * Where the key set is published, below the path of the controller.
 */
const JWKS_ROUTE: Route = '/jwks.json';

/**
 * Publishes the public keys access tokens are signed with, as a JSON Web Key Set.
 *
 * Declare it when other services verify your access tokens and you sign them with a key pair: they
 * read `/.well-known/jwks.json` and pick the key a token names in its `kid`. The key tokens are signed
 * with now is listed first, followed by every previous key that still verifies. Extend it with a
 * `@Controller` of your own to publish the keys at another path.
 */
// public by definition - a verifier fetching keys holds no credential for this application.
// `allowRedundant` for the reason AuthController gives: a controller that ships with the framework
// cannot know which `defaultAuth` the application declared
@Auth.skip({ allowRedundant: true })
@Controller('/.well-known', { allowOrphan: true, versions: 'all' })
export class JwksController {
    private readonly jwks: Jwks;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.JWT_SERVICE)
        jwtService: JwtServiceInterface
    ) {
        // resolved once: the keys are fixed for the life of the application, and the service has
        // already refused any of them that does not fit its algorithm
        const keys: Jwk[] = jwtService.getVerificationKeys()
            .map(k => JwtUtilities.resolveJwk(k))
            .filter(k => k != undefined);
        if (!keys.length) {
            // an empty set is valid json and useless: every verifier reading it refuses every token,
            // and nothing says why
            throw new InternalError([
                'JwksController is declared, but no access token key is a key pair.',
                'A shared secret cannot be published. Configure accessTokenKey on'
                + ' ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT as { algorithm, key }, or remove the controller.'
            ]);
        }
        this.jwks = { keys };
    }

    /**
     * Where the key set is published: below the application's `baseUrl`, at the path of this
     * controller or of the one extending it.
     * @returns The url of the key set.
     * @throws When the application has no `baseUrl` yet.
     */
    static resolveUrl(this: Function): string {
        return `${ControllerUtilities.resolveUrl(this)}${JWKS_ROUTE}`;
    }

    @Response.object(Jwks)
    @Get(JWKS_ROUTE)
    getJwks(): Jwks {
        return this.jwks;
    }
}

/**
 * Checks whether a controller class publishes the key set: `JwksController`, or a class extending it.
 * @param value - The class.
 * @returns True when it does.
 */
export function isJwksControllerClass(value: Newable<unknown>): value is typeof JwksController {
    return value === JwksController || value.prototype instanceof JwksController;
}