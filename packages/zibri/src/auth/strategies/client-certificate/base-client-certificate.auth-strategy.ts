import { X509Certificate } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

import { ClientCertificateHeaderFormat } from './client-certificate-header-format.type';
import { ClientCertificateHeaderUtilities } from './client-certificate-header.utilities';
import { ClientCertificateUtilities } from './client-certificate.utilities';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { InternalError } from '../../../error-handling/internal-error.model';
import { OpenApiSecuritySchemeObject } from '../../../open-api/open-api.model';
import { BaseUser } from '../../models/base-user.model';
import { AuthorizationHeaderUtilities } from '../authorization-header.utilities';
import { ClientCertificateAuthStrategyInterface } from '../client-certificate-auth-strategy.interface';

/**
 * Identifies a caller by the client certificate it showed the proxy in front of the api.
 *
 * Extend it once for every proxy. The proxy ends TLS, checks the certificate the client shows, and
 * forwards it in a header. A request has that certificate only when its connection comes from one of
 * the `trustedProxies`, and the certificate counts only when one of the `certificateAuthorities` issued
 * it and it is valid right now. `resolveUserByCertificate` then answers the user it belongs to.
 *
 * Websocket messages are never identified by it.
 */
export abstract class BaseClientCertificateAuthStrategy<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements ClientCertificateAuthStrategyInterface<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'client-certificate';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly securityScheme: OpenApiSecuritySchemeObject = {
        type: 'mutualTLS',
        description: 'A client certificate, shown to the proxy in front of the api'
    };

    /**
     * The header the proxy forwards the client certificate in, eg. `client-cert`.
     */
    abstract readonly header: string;

    /**
     * How the proxy writes the certificate into the header.
     */
    abstract readonly headerFormat: ClientCertificateHeaderFormat;

    /**
     * The proxies the header is taken from: addresses, eg. `10.0.0.7` or `::1`, and subnets, eg.
     * `10.0.0.0/8`. The header of a request whose connection comes from anywhere else is ignored.
     */
    abstract readonly trustedProxies: string[];

    /**
     * The certificates of the authorities that issue client certificates, PEM encoded: the ones that
     * sign them directly. A certificate that none of them issued is refused, and so is one outside of
     * its validity.
     */
    abstract readonly certificateAuthorities: string[];

    private proxies: BlockList = new BlockList();

    private authorities: X509Certificate[] = [];

    /**
     * Answers the user a client certificate belongs to: found by the name in its subject or in its
     * subject alternative names, or by its fingerprint. The certificate has been checked already.
     * @param certificate - The certificate.
     * @returns The user, with the roles the request holds, or undefined to refuse the request.
     */
    abstract resolveUserByCertificate(certificate: X509Certificate): Promise<UserType | undefined>;

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(): void {
        if (!this.header.trim()) {
            throw new InternalError(`${this.constructor.name} names no header the proxy forwards the certificate in.`);
        }
        if (!this.trustedProxies.length) {
            throw new InternalError(`${this.constructor.name} names no proxy to take the certificate from.`);
        }
        if (!this.certificateAuthorities.length) {
            throw new InternalError(`${this.constructor.name} names no authority that issues client certificates.`);
        }
        this.proxies = this.resolveProxies();
        this.authorities = this.certificateAuthorities.map(pem => {
            try {
                return new X509Certificate(pem);
            }
            catch (error) {
                throw new InternalError(
                    `A certificate authority of ${this.constructor.name} is not a PEM encoded certificate.`,
                    { cause: error }
                );
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    hasCredential(context: HttpRequestContext | WebsocketRequestContext): boolean {
        // a certificate being forwarded, not a good one, for the reason the jwt strategy gives. Beside
        // a bearer token bound to a certificate, the certificate is what proves the token is held by
        // the client it was issued to, so it is part of that credential rather than one of its own -
        // and identifies nobody either way, since the token alone decides who the request is from
        return this.findEncodedCertificate(context) != undefined && !AuthorizationHeaderUtilities.hasCertificateBoundToken(context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUser(context: HttpRequestContext | WebsocketRequestContext): Promise<UserType | undefined> {
        const certificate: X509Certificate | undefined = this.findClientCertificate(context);
        if (certificate == undefined || !this.isTrusted(certificate)) {
            return undefined;
        }
        return await this.resolveUserByCertificate(certificate);
    }

    /**
     * Finds the client certificate a trusted proxy forwards with a request, whoever issued it.
     * @param context - The context of the request.
     * @returns The certificate, or undefined when the request has none from a trusted proxy.
     */
    findClientCertificate(context: HttpRequestContext | WebsocketRequestContext): X509Certificate | undefined {
        const encoded: Buffer | undefined = this.findEncodedCertificate(context);
        return encoded == undefined ? undefined : this.findCertificate(encoded);
    }

    /**
     * Whether a certificate was issued by one of the authorities and is valid right now. Revocation is
     * the proxy's to check, which is where the lists of revoked certificates are configured.
     * @param certificate - The certificate.
     * @returns True when it may identify a caller.
     */
    isTrusted(certificate: X509Certificate): boolean {
        if (!ClientCertificateUtilities.isWithinValidity(certificate)) {
            return false;
        }
        // the names and key ids, and then the signature, which is what proves the authority signed it
        return this.authorities.some(authority => certificate.checkIssued(authority) && certificate.verify(authority.publicKey));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveAuthenticatedAt(): Promise<Date | undefined> {
        // a certificate is never logged in with, and when the proxy's handshake was is not forwarded
        return await Promise.resolve<Date | undefined>(undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveExpiresAt(context: HttpRequestContext | WebsocketRequestContext): Promise<Date | undefined> {
        return await Promise.resolve(this.findClientCertificate(context)?.validToDate);
    }

    /**
     * Finds the certificate a trusted proxy forwards with a request.
     * @param context - The context of the request.
     * @returns The certificate as PEM or DER, or undefined when the request has none from a trusted
     * proxy.
     */
    private findEncodedCertificate(context: HttpRequestContext | WebsocketRequestContext): Buffer | undefined {
        // a websocket message carries headers the client wrote into it, which no proxy ever sees
        if (context.type !== 'http-request') {
            return undefined;
        }
        // the address of the connection itself, never req.ip: that one comes from x-forwarded-for for
        // as many hops as security.trustProxy allows, which is a header anybody can send. The
        // certificate header is just as easy to send, so what makes it true is who connected
        const address: string | undefined = context.request.socket.remoteAddress;
        if (address == undefined || !this.proxies.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')) {
            return undefined;
        }
        const value: string | string[] | undefined = context.request.headers[this.header.toLowerCase()];
        return typeof value === 'string'
            ? ClientCertificateHeaderUtilities.findEncodedCertificate(value, this.headerFormat)
            : undefined;
    }

    /**
     * Reads a forwarded certificate.
     * @param encoded - The certificate as PEM or DER.
     * @returns The certificate, or undefined when it is not one.
     */
    private findCertificate(encoded: Buffer): X509Certificate | undefined {
        try {
            return new X509Certificate(encoded);
        }
        catch {
            return undefined;
        }
    }

    /**
     * Reads the trusted proxies.
     * @returns The addresses and subnets to take the header from.
     * @throws An InternalError when one of them is neither an address nor a subnet.
     */
    private resolveProxies(): BlockList {
        const proxies: BlockList = new BlockList();
        for (const entry of this.trustedProxies) {
            const [address = '', prefix, ...rest] = entry.trim().split('/');
            const family: number = isIP(address);
            const maxPrefix: number = family === 6 ? 128 : 32;
            if (family === 0 || rest.length || (prefix != undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > maxPrefix))) {
                throw new InternalError(`The trusted proxy "${entry}" of ${this.constructor.name} is neither an address nor a subnet.`);
            }
            const type: 'ipv4' | 'ipv6' = family === 6 ? 'ipv6' : 'ipv4';
            if (prefix == undefined) {
                proxies.addAddress(address, type);
            }
            else {
                proxies.addSubnet(address, Number(prefix), type);
            }
        }
        return proxies;
    }
}