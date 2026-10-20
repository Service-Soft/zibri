import { X509Certificate } from 'node:crypto';

import { AuthStrategyInterface } from './auth-strategy.interface.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for an auth strategy that identifies a caller by the client certificate of a request.
 *
 * The authorization server authenticates clients by their certificates through the registered strategy
 * implementing it, and a token bound to a certificate is taken only beside the certificate it finds.
 */
export interface ClientCertificateAuthStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>
> extends AuthStrategyInterface<RoleType, UserType> {
    /**
     * Finds the client certificate a request presents, whoever issued it.
     */
    findClientCertificate: (context: HttpRequestContext | WebsocketRequestContext) => X509Certificate | undefined,
    /**
     * Whether a certificate may identify a caller: issued by an authority the strategy trusts, valid
     * right now, and one for a client.
     */
    isTrusted: (certificate: X509Certificate) => boolean,
    /**
     * Resolves the user a trusted certificate belongs to, or undefined to refuse it.
     */
    resolveUserByCertificate: (certificate: X509Certificate) => Promise<UserType | undefined>
}

/**
 * Checks whether or not the given auth strategy identifies callers by their client certificates.
 * @param strategy - The strategy to check.
 * @returns True if all keys of the ClientCertificateAuthStrategyInterface are present, false otherwise.
 */
export function isClientCertificateAuthStrategy(
    strategy: AuthStrategyInterface<string, BaseUser<string>>
): strategy is ClientCertificateAuthStrategyInterface<string, BaseUser<string>> {
    const keys: (keyof ClientCertificateAuthStrategyInterface<string, BaseUser<string>>)[] = [
        'findClientCertificate',
        'isTrusted',
        'resolveUserByCertificate'
    ];
    return keys.every(key => key in strategy);
}