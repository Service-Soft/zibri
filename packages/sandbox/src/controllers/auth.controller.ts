import { AuthController, Controller, JwtAuthStrategy, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

/**
 * The auth routes: logging in with a password, refreshing a login and logging out, resetting a
 * password, and enrolling a second factor. The options name what the application registers.
 */
@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [PasswordAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}