import { PasskeyAuthenticationResponse } from './passkey-authentication-response.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * What the browser answered once a device used a passkey to sign in, as the client sends it.
 */
export class PasskeySignInInput {
    /**
     * The browser's answer.
     */
    @Property.object({ cls: () => PasskeyAuthenticationResponse })
    response!: PasskeyAuthenticationResponse;
}