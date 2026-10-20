import { OtpTwoFactorMethod } from '../../../auth/2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../../auth/auth-controller/auth-controller.model.ts';
import { PasswordAuthenticator } from '../../../auth/authenticators/password/password.authenticator.ts';
import { CookieAuthStrategy } from '../../../auth/strategies/cookie/cookie-auth.auth-strategy.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';

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