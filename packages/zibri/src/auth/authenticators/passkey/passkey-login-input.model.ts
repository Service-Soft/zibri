import { PasskeyAuthenticationResponse } from './passkey-authentication-response.model';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What the browser answered once a device used a passkey to log in, as the client sends it.
 */
export class PasskeyLoginInput {
    /**
     * The browser's answer.
     */
    @Property.object({ cls: () => PasskeyAuthenticationResponse })
    response!: PasskeyAuthenticationResponse;
}