import { OtpTwoFactorMethod } from '../../../auth/2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../../auth/auth-controller/auth-controller.model';
import { PasswordAuthenticator } from '../../../auth/authenticators/password/password.authenticator';
import { JwtAuthStrategy } from '../../../auth/strategies/jwt/jwt.auth-strategy';
import { Controller } from '../../../routing/decorators/controller.decorator';

/**
 * The auth routes of an application on the defaults: jwt logins, passwords, and the authenticator app
 * as the second factor.
 */
// an orphan for every suite that imports a file declaring it without registering it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
export class JwtTestAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [PasswordAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}