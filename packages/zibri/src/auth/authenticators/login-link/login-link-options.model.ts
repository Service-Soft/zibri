import { LoginLinkEmailTemplate } from './login-link-email-template.model';
import { LoginLinkSecondFactor } from './login-link-second-factor.type';

/**
 * How links to log in with are sent and taken, as `ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS` takes it. Required with
 * `LoginLinkAuthenticator`.
 */
export type LoginLinkOptions = {
    /**
     * The page of the frontend a link opens, followed by its token, such as `https://app.example.com/login-link`. The
     * page posts the token to the login route. The tenant of the request asking for the link is put in by
     * `resolveTenantUrl` of the `TenantService`.
     */
    loginLinkUrl: string,
    /**
     * The email a link is sent in.
     */
    loginLinkEmail: LoginLinkEmailTemplate,
    /**
     * How long a link works. 15 minutes by default.
     */
    tokenExpiresInMs?: number,
    /**
     * Whether a login by a link asks for a second factor. `'twoFactorAtLogin'` by default.
     */
    secondFactor?: LoginLinkSecondFactor,
    /**
     * Whether a link works only in the browser that asked for it, which gets a cookie with the request. False by
     * default.
     */
    bindToBrowser?: boolean
};