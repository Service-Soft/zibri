import { HttpRequestContext } from '../../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../../context/request/websocket-request.context';
import { Transaction } from '../../../../data-source/transaction/transaction.model';
import { Inject } from '../../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { UnauthorizedError } from '../../../../error-handling/errors/unauthorized.error';
import { findHeader } from '../../../../http/find-header.function';
import { MimeType } from '../../../../http/mime-type.enum';
import { $ts } from '../../../../localization/translate.function';
import { JsonBodyMetadata, XmlBodyMetadata } from '../../../../routing/decorators/body-metadata.model';
import { resolveStructuredBodyMetadata } from '../../../../routing/resolve-body-metadata.function';
import { Newable } from '../../../../types/newable.type';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { PasskeyAdditionRequest } from '../../../authenticators/passkey/passkey-addition-request.model';
import { PasskeyAuthenticationResponse } from '../../../authenticators/passkey/passkey-authentication-response.model';
import { PasskeyCreationOptions } from '../../../authenticators/passkey/passkey-creation-options.model';
import { PasskeyRegistrationResponse } from '../../../authenticators/passkey/passkey-registration-response.model';
import { PasskeyRequestOptions } from '../../../authenticators/passkey/passkey-request-options.model';
import { type PasskeyServiceInterface } from '../../../authenticators/passkey/passkey-service.interface';
import { UserAccount } from '../../../models/user-account.model';
import { TwoFactorMethod } from '../two-factor-method.interface';

/**
 * A passkey as the second factor of an operation. The device always verifies its user, with a
 * fingerprint or a PIN.
 *
 * The client asks for a challenge with `requestSecondFactor`, at the `2fa/request` route of `AuthController`,
 * has the browser use a passkey with it, and sends the answer base64url encoded in the
 * `x-authorization-passkey` header of the guarded request.
 *
 * The passkeys are those `PasskeyAuthenticator` logs in with, so enrolling one here adds a passkey to
 * the user, and removing this method removes every passkey of theirs.
 */
export class PasskeyTwoFactorMethod
implements TwoFactorMethod<PasskeyAdditionRequest, PasskeyRegistrationResponse, PasskeyCreationOptions, PasskeyRequestOptions> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'passkey';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationRequestModel: Newable<PasskeyAdditionRequest> = PasskeyAdditionRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationConfirmModel: Newable<PasskeyRegistrationResponse> = PasskeyRegistrationResponse;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationRequestResultModel: Newable<PasskeyCreationOptions> = PasskeyCreationOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secondFactorRequestModel: Newable<PasskeyRequestOptions> = PasskeyRequestOptions;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_SERVICE)
        private readonly passkeyService: PasskeyServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_HEADER)
        private readonly passkeyHeader: string
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSecondFactor<UserType extends UserAccount>(user: UserType): Promise<PasskeyRequestOptions> {
        return await this.passkeyService.requestSecondFactor(user.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegistration<UserType extends UserAccount>(
        user: UserType,
        data: PasskeyAdditionRequest
    ): Promise<PasskeyCreationOptions> {
        return await this.passkeyService.requestAddition(user.id, data.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegistration<UserType extends UserAccount>(
        user: UserType,
        data: PasskeyRegistrationResponse
    ): Promise<void> {
        await this.passkeyService.confirmAddition(user.id, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeRegistration<UserType extends UserAccount>(user: UserType): Promise<void> {
        await this.passkeyService.removePasskeys(user.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: Transaction): Promise<void> {
        await this.passkeyService.deleteUserRows(userIds, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isRegistered<UserType extends UserAccount>(user: UserType): Promise<boolean> {
        return (await this.passkeyService.findPasskeys(user.id, undefined)).length > 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validate<UserType extends UserAccount>(
        user: UserType,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        await this.passkeyService.verifySecondFactor(user.id, await this.resolveResponse(context));
    }

    private async resolveResponse(context: HttpRequestContext | WebsocketRequestContext): Promise<PasskeyAuthenticationResponse> {
        const header: string | undefined = findHeader(context.request.headers, this.passkeyHeader);
        if (!header) {
            throw new UnauthorizedError($ts`"${this.passkeyHeader}" header not found`);
        }
        let response: PasskeyAuthenticationResponse;
        try {
            response = JsonUtilities.parse(Buffer.from(header, 'base64url').toString('utf8'));
        }
        catch (error) {
            throw new UnauthorizedError($ts`The "${this.passkeyHeader}" header is not a passkey.`, { cause: error });
        }
        // read the way a json body of the model is, since it is what the browser would send as one
        const metadata: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata(
            { type: MimeType.JSON, modelClass: PasskeyAuthenticationResponse },
            0
        );
        try {
            await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(response, metadata);
        }
        catch (error) {
            throw new UnauthorizedError($ts`The "${this.passkeyHeader}" header is not a passkey.`, { cause: error });
        }
        return response;
    }
}