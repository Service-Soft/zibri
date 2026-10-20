import { PasskeyAuthenticationResponse } from './passkey-authentication-response.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * The ticket a sign-up with a passkey continues with, which the login it ends in spends. A body the
 * application's own sign-up route can take as it is.
 */
export class PasskeyTicketCredentials {
    /**
     * The ticket.
     */
    @Property.string()
    ticket!: string;
}

/**
 * What logs in with a passkey: the browser's answer to a sign-in challenge, or the ticket of a sign-up.
 */
export type PasskeyCredentials = {
    /**
     * The browser's answer.
     */
    response: PasskeyAuthenticationResponse
} | PasskeyTicketCredentials;