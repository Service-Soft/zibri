import { PasskeyRegistrationResponse } from './passkey-registration-response.model';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What the browser answered once a device created a passkey, as the client sends it.
 */
export class PasskeyRegistrationInput {
    /**
     * The browser's answer.
     */
    @Property.object({ cls: () => PasskeyRegistrationResponse })
    response!: PasskeyRegistrationResponse;
}