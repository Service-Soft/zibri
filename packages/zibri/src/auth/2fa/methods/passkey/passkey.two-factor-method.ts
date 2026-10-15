import { HttpRequestContext } from '../../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../../context/request/websocket-request.context';
import { Inject } from '../../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { UnauthorizedError } from '../../../../error-handling/errors/unauthorized.error';
import { MimeType } from '../../../../http/mime-type.enum';
import { $ts } from '../../../../localization/translate.function';
import { JsonBodyMetadata, XmlBodyMetadata } from '../../../../routing/decorators/body-metadata.model';
import { resolveStructuredBodyMetadata } from '../../../../routing/resolve-body-metadata.function';
import { Newable } from '../../../../types/newable.type';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { PasskeyAuthenticationResponse } from '../../../authenticators/passkey/passkey-authentication-response.model';
import { PasskeyConnectionRequest } from '../../../authenticators/passkey/passkey-connection-request.model';
import { PasskeyCreationOptions } from '../../../authenticators/passkey/passkey-creation-options.model';
import { PasskeyRegistrationResponse } from '../../../authenticators/passkey/passkey-registration-response.model';
import { PasskeyRequestOptions } from '../../../authenticators/passkey/passkey-request-options.model';
import { type PasskeyServiceInterface } from '../../../authenticators/passkey/passkey-service.interface';
import { BaseUser } from '../../../models/base-user.model';
import { TwoFactorMethod } from '../two-factor-method.interface';

/**
 * A passkey as the second factor of an operation. The device always verifies its user, with a
 * fingerprint or a PIN.
 *
 * The client asks for a challenge with `startSecondFactor`, at the `2fa/start` route of `AuthController`,
 * has the browser use a passkey with it, and sends the answer base64url encoded in the
 * `x-authorization-passkey` header of the guarded request.
 *
 * The passkeys are those `PasskeyAuthenticator` signs in with, so enrolling one here adds a passkey to
 * the user, and removing this method removes every passkey of theirs.
 */
export class PasskeyTwoFactorMethod
implements TwoFactorMethod<PasskeyConnectionRequest, PasskeyRegistrationResponse, PasskeyCreationOptions, PasskeyRequestOptions> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'passkey';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly requestRegisterModel: Newable<PasskeyConnectionRequest> = PasskeyConnectionRequest;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly confirmRegisterModel: Newable<PasskeyRegistrationResponse> = PasskeyRegistrationResponse;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationModel: Newable<PasskeyCreationOptions> = PasskeyCreationOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secondFactorStartModel: Newable<PasskeyRequestOptions> = PasskeyRequestOptions;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_SERVICE)
        private readonly passkeyService: PasskeyServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_HEADER)
        private readonly passkeyHeader: string
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startSecondFactor<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<PasskeyRequestOptions> {
        return await this.passkeyService.startSecondFactor(user.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: PasskeyConnectionRequest
    ): Promise<PasskeyCreationOptions> {
        return await this.passkeyService.startConnection(user.id, data.name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegisterForUser<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: PasskeyRegistrationResponse
    ): Promise<void> {
        await this.passkeyService.completeConnection(user.id, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unregisterForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<void> {
        await this.passkeyService.removePasskeys(user.id);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isRegisteredForUser<Role extends string, UserType extends BaseUser<Role>>(user: UserType): Promise<boolean> {
        return (await this.passkeyService.findPasskeys(user.id, undefined)).length > 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validate<Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        await this.passkeyService.verifySecondFactor(user.id, await this.resolveResponse(context));
    }

    private async resolveResponse(context: HttpRequestContext | WebsocketRequestContext): Promise<PasskeyAuthenticationResponse> {
        const header: string | undefined = context.request.headers?.[this.passkeyHeader];
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