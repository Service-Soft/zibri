import { PasskeyConnectionRequest } from './passkey-connection-request.model';
import { PasskeyCreationOptions } from './passkey-creation-options.model';
import { PasskeyCredentials, PasskeyTicketCredentials } from './passkey-credentials.model';
import { PasskeyRegistrationInput } from './passkey-registration-input.model';
import { PasskeyRegistrationTicket } from './passkey-registration-ticket.model';
import { PasskeyRegistration } from './passkey-registration.model';
import { PasskeyRequestOptions } from './passkey-request-options.model';
import { type PasskeyServiceInterface } from './passkey-service.interface';
import { PasskeySignInInput } from './passkey-sign-in-input.model';
import { PasskeySignUpRequest } from './passkey-sign-up-request.model';
import { Passkey } from './passkey.model';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { $ts } from '../../../localization/translate.function';
import { Newable } from '../../../types/newable.type';
import { Authentication } from '../../models/authentication.model';
import { BaseUser } from '../../models/base-user.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { ConnectingAuthenticatorInterface } from '../connecting-authenticator.interface';
import { ConnectionCompletingAuthenticatorInterface } from '../connection-completing-authenticator.interface';
import { SignInOptionsAuthenticatorInterface } from '../sign-in-options-authenticator.interface';
import { SignUpAuthenticatorInterface } from '../sign-up-authenticator.interface';

/**
 * Authenticates a user by a passkey: a key their device holds and only uses once it verified them, with
 * a fingerprint or a PIN. Nothing to type, and bound to the site, so a phishing page cannot use it.
 *
 * Signs in without an email: the device offers the passkeys it holds for the site, and the one picked
 * names the user. Its routes are those of `AuthController`. A passkey is linked to a user like a
 * provider's identity, so `AuthServiceInterface` lists, adds and removes them.
 */
export class PasskeyAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements ConnectingAuthenticatorInterface<
    RoleType,
    UserType,
    PasskeyCredentials,
    PasskeyTicketCredentials,
    PasskeyRegistration,
    Passkey,
    PasskeyConnectionRequest,
    PasskeyCreationOptions
>,
    SignInOptionsAuthenticatorInterface<RoleType, UserType, PasskeyCredentials, PasskeyRequestOptions>,
    SignUpAuthenticatorInterface<
        RoleType,
        UserType,
        PasskeyCredentials,
        PasskeySignUpRequest,
        PasskeyCreationOptions,
        PasskeyRegistrationInput,
        PasskeyTicketCredentials
    >,
    ConnectionCompletingAuthenticatorInterface<RoleType, UserType, PasskeyCredentials, PasskeyRegistrationInput> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'passkey';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly credentialsModel: Newable<PasskeyCredentials> = PasskeySignInInput;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly signInOptionsModel: Newable<PasskeyRequestOptions> = PasskeyRequestOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly signUpRequestModel: Newable<PasskeySignUpRequest> = PasskeySignUpRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly signUpOptionsModel: Newable<PasskeyCreationOptions> = PasskeyCreationOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly signUpAnswerModel: Newable<PasskeyRegistrationInput> = PasskeyRegistrationInput;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly ticketModel: Newable<PasskeyTicketCredentials> = PasskeyTicketCredentials;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly connectionRequestModel: Newable<PasskeyConnectionRequest> = PasskeyConnectionRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly connectionStartModel: Newable<PasskeyCreationOptions> = PasskeyCreationOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly connectionAnswerModel: Newable<PasskeyRegistrationInput> = PasskeyRegistrationInput;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_SERVICE)
        private readonly passkeyService: PasskeyServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSignInOptions(): Promise<PasskeyRequestOptions> {
        return await this.passkeyService.startSignIn();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSignUpOptions(request: PasskeySignUpRequest): Promise<PasskeyCreationOptions> {
        return await this.passkeyService.startSignUp(request.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async completeSignUp(answer: PasskeyRegistrationInput): Promise<PasskeyTicketCredentials> {
        return { ticket: await this.passkeyService.completeSignUp(answer.response) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async completeConnection(userId: string, answer: PasskeyRegistrationInput): Promise<void> {
        await this.passkeyService.completeConnection(userId, answer.response);
    }

    /**
     * Starts adding a passkey to a user. `AuthServiceInterface.startConnection` calls it for the user
     * logged in with the request.
     * @param userId - The user.
     * @param request - The name the device lists the account under.
     * @returns What the browser creates the passkey with. Its answer goes to the `connect/complete` route
     * of `AuthController`, by the same user.
     */
    async startConnection(userId: string, request: PasskeyConnectionRequest): Promise<PasskeyCreationOptions> {
        return await this.passkeyService.startConnection(userId, request.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async authenticate(credentials: PasskeyCredentials, transaction: Transaction | undefined): Promise<Authentication<UserType>> {
        if ('ticket' in credentials) {
            const ticket: PasskeyRegistrationTicket = await this.passkeyService.spendRegistrationTicket(credentials.ticket, transaction);
            return { user: await this.resolveUser(ticket.userId), authenticatedAt: new Date(ticket.authenticatedAt) };
        }
        const passkey: Passkey = await this.passkeyService.verifySignIn(credentials.response, transaction);
        return { user: await this.resolveUser(passkey.userId), authenticatedAt: new Date() };
    }

    /**
     * Reads what the passkey of a sign-up says about the user, for creating them. Does not spend the
     * ticket.
     * @param credentials - The ticket.
     * @param transaction - The transaction the registration runs in, if any.
     * @returns The name the device lists the account under, and the device.
     * @throws UnauthorizedError when the ticket is unknown, spent or expired.
     */
    async resolveRegistration(credentials: PasskeyTicketCredentials, transaction: Transaction | undefined): Promise<PasskeyRegistration> {
        const ticket: PasskeyRegistrationTicket = await this.passkeyService.findRegistrationTicket(credentials.ticket, transaction);
        return { name: ticket.userName, aaguid: ticket.aaguid, synced: ticket.synced };
    }

    /**
     * Adds the passkey of a sign-up to the user created for it, so the ticket logs them in. Does not
     * spend the ticket.
     * @param credentials - The ticket.
     * @param userId - The user.
     * @param transaction - The transaction the registration runs in, if any.
     * @throws UnauthorizedError when the ticket is unknown, spent, expired or added to a user already.
     */
    async linkIdentity(credentials: PasskeyTicketCredentials, userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.passkeyService.linkRegistrationTicket(credentials.ticket, userId, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIdentities(userId: string, transaction: Transaction | undefined): Promise<Passkey[]> {
        return await this.passkeyService.findPasskeys(userId, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unlinkIdentity(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        await this.passkeyService.removePasskey(userId, identityId, transaction);
    }

    private async resolveUser(userId: string | undefined): Promise<UserType> {
        const user: UserType | undefined = userId == undefined
            ? undefined
            : await this.userService.findById<RoleType, UserType, false>(userId, { required: false });
        if (user == undefined) {
            throw new UnauthorizedError($ts`No user is linked to this sign-in.`);
        }
        return user;
    }
}