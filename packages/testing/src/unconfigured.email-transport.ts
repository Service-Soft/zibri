import { EmailTransportInterface, InternalError } from 'zibri';

/**
 * The mail transport every test server gets unless it names one.
 *
 * EmailService is constructed by anything that can send a mail - both auth strategies do - so nearly
 * every suite needs *a* transport whether or not it sends anything. This one refuses to send, which
 * is the honest default: it matches the `maxEmailsPerHour: 0` beside it, and a suite that starts
 * sending mail without saying where fails naming what to do about it rather than passing over a
 * transport that quietly swallowed the message.
 */
export class UnconfiguredEmailTransport implements EmailTransportInterface {

    /**
     * What this transport is called wherever a transport is named.
     */
    readonly name: string = 'UnconfiguredEmailTransport';

    /**
     * Refuses to send, naming the token to register a real transport under.
     */
    // eslint-disable-next-line typescript/require-await
    async send(): Promise<never> {
        throw new InternalError(
            'this test server sends mail but registered no transport.'
            + ' Provide one for ZIBRI_DI_TOKENS.EMAIL_TRANSPORT in the suite\'s own providers'
        );
    }
}