import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * What a logout answers with.
 */
export class LogoutResult {
    /**
     * Where to send the browser to log out at the provider the login was started at too. Undefined when
     * the login was not started at a provider, or the provider cannot be logged out at.
     */
    @Property.string({ required: false })
    providerLogoutUrl?: string;
}