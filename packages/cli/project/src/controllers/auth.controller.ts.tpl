import { AuthController, Controller, JwtAuthStrategy, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

/**
 * The auth routes: logging in with a password, refreshing a login and logging out, resetting a
 * password, enrolling a second factor and listing the enrolled ones, seeing who is logged in,
 * changing their language, and which ways of logging in there are. The options name what the
 * application registers.
 */
@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [PasswordAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod],
    currentUserRoute: true,
    updateCurrentUserRoute: true,
    twoFactorRegistrationsRoute: true,
    loginMethodsRoute: true
}) {}
