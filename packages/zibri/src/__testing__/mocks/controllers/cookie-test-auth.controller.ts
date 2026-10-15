import { OtpTwoFactorMethod } from '../../../auth/2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../../auth/auth-controller/auth-controller.model';
import { PasswordAuthenticator } from '../../../auth/authenticators/password/password.authenticator';
import { CookieAuthStrategy } from '../../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { Controller } from '../../../routing/decorators/controller.decorator';

/**
 * The auth routes of an application logging in with cookies, on passwords and the authenticator app
 * as the second factor.
 */
// an orphan for every suite that imports a file declaring it without registering it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
export class CookieTestAuthController extends AuthController({
    strategies: [CookieAuthStrategy],
    authenticators: [PasswordAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}