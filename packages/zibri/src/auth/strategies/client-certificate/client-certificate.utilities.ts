import { X509Certificate } from 'node:crypto';

import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { isClientCertificateAuthStrategy } from '../client-certificate-auth-strategy.interface.ts';
import { JwtUtilities } from '../jwt/jwt.utilities.ts';

/**
 * Checks client certificates, whoever presents and whoever issued them.
 */
export abstract class ClientCertificateUtilities {
    /**
     * Whether a request sends an access token beside the certificate it is bound to, as a strategy for
     * client certificates of the application finds it.
     * @param context - The context of the request.
     * @param certificateThumbprint - The thumbprint of the certificate the token is bound to, if any.
     * @returns True for a token bound to no certificate, or one the request presents.
     */
    static isSentWithBoundCertificate(
        context: HttpRequestContext | WebsocketRequestContext,
        certificateThumbprint: string | undefined
    ): boolean {
        if (certificateThumbprint == undefined) {
            return true;
        }
        // a token stolen without the certificate's private key is worth nothing
        const certificate: X509Certificate | undefined = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
            .resolveStrategies(isClientCertificateAuthStrategy)
            .map(strategy => strategy.findClientCertificate(context))
            .find(c => c != undefined);
        return certificate != undefined && JwtUtilities.resolveCertificateThumbprint(certificate) === certificateThumbprint;
    }

    /**
     * Whether a certificate is valid right now, whoever issued it.
     * @param certificate - The certificate.
     * @returns True between its start and its end.
     */
    static isWithinValidity(certificate: X509Certificate): boolean {
        const now: number = Date.now();
        return now >= certificate.validFromDate.getTime() && now <= certificate.validToDate.getTime();
    }
}