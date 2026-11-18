import { Property } from '../../../../entity/decorators/property.decorator';

/**
 * What requesting to register the sms two factor method takes.
 */
export class SmsRegistrationRequestData {
    /**
     * The phone number to send the codes to, in international format, eg. `+4915112345678`.
     */
    @Property.string({ format: 'phone' })
    phoneNumber!: string;
}