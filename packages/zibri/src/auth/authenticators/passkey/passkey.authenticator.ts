import { PasskeyAdditionRequest } from './passkey-addition-request.model';
import { PasskeyCreationOptions } from './passkey-creation-options.model';
import { PasskeyCredentials, PasskeyTicketCredentials } from './passkey-credentials.model';
import { PasskeyRegistrationInput } from './passkey-registration-input.model';
import { PasskeyRegistrationRequest } from './passkey-registration-request.model';
import { PasskeyRegistrationTicket } from './passkey-registration-ticket.model';
import { PasskeyRegistration } from './passkey-registration.model';
import { PasskeyRequestOptions } from './passkey-request-options.model';
import { type PasskeyServiceInterface } from './passkey-service.interface';
import { PasskeyLoginInput } from './passkey-login-input.model';
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
import { LinkIdentityConfirmingAuthenticatorInterface } from '../link-identity-confirming-authenticator.interface';
import { LinkIdentityRequestingAuthenticatorInterface } from '../link-identity-requesting-authenticator.interface';
import { LoginOptionsAuthenticatorInterface } from '../login-options-authenticator.interface';
import { RegistrationAuthenticatorInterface } from '../registration-authenticator.interface';

/**
 * Authenticates a user by a passkey: a key their device holds and only uses once it verified them, with
 * a fingerprint or a PIN. Nothing to type, and bound to the site, so a phishing page cannot use it.
 *
 * Logs in without an email: the device offers the passkeys it holds for the site, and the one picked
 * names the user. Its routes are those of `AuthController`. A passkey is linked to a user like a
 * provider's identity, so `AuthServiceInterface` lists, adds and removes them.
 */
export class PasskeyAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements LinkIdentityRequestingAuthenticatorInterface<
    RoleType,
    UserType,
    PasskeyCredentials,
    PasskeyTicketCredentials,
    PasskeyRegistration,
    Passkey,
    PasskeyAdditionRequest,
    PasskeyCreationOptions
>,
    LoginOptionsAuthenticatorInterface<RoleType, UserType, PasskeyCredentials, PasskeyRequestOptions>,
    RegistrationAuthenticatorInterface<
        RoleType,
        UserType,
        PasskeyCredentials,
        PasskeyRegistrationRequest,
        PasskeyCreationOptions,
        PasskeyRegistrationInput,
        PasskeyTicketCredentials
    >,
    LinkIdentityConfirmingAuthenticatorInterface<RoleType, UserType, PasskeyCredentials, PasskeyRegistrationInput> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'passkey';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly credentialsModel: Newable<PasskeyCredentials> = PasskeyLoginInput;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly loginOptionsModel: Newable<PasskeyRequestOptions> = PasskeyRequestOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationRequestModel: Newable<PasskeyRegistrationRequest> = PasskeyRegistrationRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationOptionsModel: Newable<PasskeyCreationOptions> = PasskeyCreationOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationAnswerModel: Newable<PasskeyRegistrationInput> = PasskeyRegistrationInput;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly ticketModel: Newable<PasskeyTicketCredentials> = PasskeyTicketCredentials;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly linkIdentityRequestModel: Newable<PasskeyAdditionRequest> = PasskeyAdditionRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly linkIdentityStartModel: Newable<PasskeyCreationOptions> = PasskeyCreationOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly linkIdentityAnswerModel: Newable<PasskeyRegistrationInput> = PasskeyRegistrationInput;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_SERVICE)
        private readonly passkeyService: PasskeyServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.USER_SERVICE)
        private readonly userService: UserServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveLoginOptions(): Promise<PasskeyRequestOptions> {
        return await this.passkeyService.requestLogin();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegistration(request: PasskeyRegistrationRequest): Promise<PasskeyCreationOptions> {
        return await this.passkeyService.requestRegistration(request.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegistration(answer: PasskeyRegistrationInput): Promise<PasskeyTicketCredentials> {
        return { ticket: await this.passkeyService.confirmRegistration(answer.response) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmLinkIdentity(userId: string, answer: PasskeyRegistrationInput): Promise<void> {
        await this.passkeyService.confirmAddition(userId, answer.response);
    }

    /**
     * Requests adding a passkey to a user. `AuthServiceInterface.requestLinkIdentity` calls it for the
     * user logged in with the request.
     * @param userId - The user.
     * @param request - The name the device lists the account under.
     * @returns What the browser creates the passkey with. Its answer goes to the `link-identity/confirm`
     * route of `AuthController`, by the same user.
     */
    async requestLinkIdentity(userId: string, request: PasskeyAdditionRequest): Promise<PasskeyCreationOptions> {
        return await this.passkeyService.requestAddition(userId, request.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async authenticate(credentials: PasskeyCredentials, transaction: Transaction | undefined): Promise<Authentication<UserType>> {
        if ('ticket' in credentials) {
            const ticket: PasskeyRegistrationTicket = await this.passkeyService.spendRegistrationTicket(credentials.ticket, transaction);
            return { user: await this.resolveUser(ticket.userId), authenticatedAt: new Date(ticket.authenticatedAt) };
        }
        const passkey: Passkey = await this.passkeyService.confirmLogin(credentials.response, transaction);
        return { user: await this.resolveUser(passkey.userId), authenticatedAt: new Date() };
    }

    /**
     * Reads what the passkey of a registration says about the user, for creating them. Does not spend
     * the ticket.
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
     * Adds the passkey of a registration to the user created for it, so the ticket logs them in. Does
     * not spend the ticket.
     * @param credentials - The ticket.
     * @param userId - The user.
     * @param transaction - The transaction the registration runs in, if any.
     * @throws UnauthorizedError when the ticket is unknown, spent, expired or added to a user already.
     */
    async linkTicketIdentity(credentials: PasskeyTicketCredentials, userId: string, transaction: Transaction | undefined): Promise<void> {
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: Transaction): Promise<void> {
        await this.passkeyService.deleteUserRows(userIds, transaction);
    }

    private async resolveUser(userId: string | undefined): Promise<UserType> {
        const user: UserType | undefined = userId == undefined
            ? undefined
            : await this.userService.findById<RoleType, UserType, false>(userId, { required: false });
        if (user == undefined) {
            throw new UnauthorizedError($ts`No user is linked to this login.`);
        }
        return user;
    }
}
