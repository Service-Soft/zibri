import { randomBytes, sign, verify, X509Certificate } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { SignedXml } from 'xml-crypto';
import { encrypt } from 'xml-encryption';
import { KnownHeader, MimeType } from 'zibri';

import { FakeSamlAnswerChanges } from './fake-saml-answer-changes.model.ts';
import { FakeSamlAnswer } from './fake-saml-answer.model.ts';
import { FakeSamlBackChannelAnswer } from './fake-saml-back-channel-answer.model.ts';
import { FakeSamlIdentity } from './fake-saml-identity.model.ts';
import { FakeSamlLogoutForm } from './fake-saml-logout-form.model.ts';
import { FakeSamlLogoutOptions } from './fake-saml-logout-options.model.ts';
import { FakeSamlLogoutRequest } from './fake-saml-logout-request.model.ts';
import { FakeSamlLogoutResponse } from './fake-saml-logout-response.model.ts';
import { FakeSamlProviderOptions } from './fake-saml-provider-options.model.ts';
import { FakeSamlRequest } from './fake-saml-request.model.ts';
import { createFakeKeyPair } from '../create-fake-key-pair.function.ts';
import { FakeKeyPair } from '../fake-key-pair.model.ts';

/**
 * The algorithms the answers are signed with: exclusive canonicalization, and RSA with SHA-256.
 */
const SIGNATURE_ALGORITHM: string = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const CANONICALIZATION_ALGORITHM: string = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const DIGEST_ALGORITHM: string = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPED_SIGNATURE: string = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/**
 * The status of an answer that signs the user in.
 */
const SUCCESS_STATUS: string = 'urn:oasis:names:tc:SAML:2.0:status:Success';

/**
 * The namespace of SAML protocol messages.
 */
const PROTOCOL_NAMESPACE: string = 'urn:oasis:names:tc:SAML:2.0:protocol';

/**
 * The namespace of SAML assertions.
 */
const ASSERTION_NAMESPACE: string = 'urn:oasis:names:tc:SAML:2.0:assertion';

/**
 * The namespace of SOAP 1.1 envelopes, which the SOAP binding carries messages in.
 */
const SOAP_NAMESPACE: string = 'http://schemas.xmlsoap.org/soap/envelope/';

/**
 * The bindings a metadata document names, by what the provider is configured with.
 */
const BINDINGS: Record<'redirect' | 'post', string> = {
    redirect: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
    post: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'
};

/**
 * How the user signed in, as every answer says: with a password over a protected connection.
 */
const PASSWORD_AUTHN_CONTEXT: string = 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport';

/**
 * The NameID format of a user the provider names however it is configured to.
 */
const UNSPECIFIED_NAME_ID_FORMAT: string = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified';

/**
 * How long an assertion is valid, as the provider issues it.
 */
const ASSERTION_LIFETIME_IN_MS: number = 300000;

/**
 * A SAML 2.0 identity provider running inside a test, reached over plain http on the loopback
 * interface.
 *
 * It signs in whoever `identity` says without asking anything, answers with a page that posts the
 * signed response to the service provider, and keeps what it was asked, so a test can drive a sign-in
 * end to end and see what the application sent.
 */
export class FakeSamlProvider {
    /**
     * Who the next sign-in signs in as.
     */
    identity: FakeSamlIdentity = {
        nameId: 'fake-name-id',
        attributes: { email: 'fake@example.com', givenName: 'Fake', sn: 'User' }
    };

    /**
     * When the next sign-in says the user signed in at the provider. Now, when undefined, or after a
     * request asking the user to sign in again.
     */
    authenticatedAt: Date | undefined;

    /**
     * Every request the provider was sent to sign a user in, in order.
     */
    readonly requests: FakeSamlRequest[] = [];

    /**
     * Every answer the provider gave, in order: the form its page posts to the service provider.
     */
    readonly answers: FakeSamlAnswer[] = [];

    /**
     * Every logout request the provider was sent, in order.
     */
    readonly logoutRequests: FakeSamlLogoutRequest[] = [];

    /**
     * Every logout response the service provider posted to the provider, in order.
     */
    readonly logoutResponses: FakeSamlLogoutResponse[] = [];

    /**
     * Every answer to a logout request the provider's page posted, in order, when it answers with a form.
     */
    readonly logoutAnswers: FakeSamlLogoutForm[] = [];

    /**
     * How often the metadata was read.
     */
    metadataReads: number = 0;

    private readonly server: Server;
    private url: string | undefined;
    private deniedWith: string | undefined;
    private nextChanges: FakeSamlAnswerChanges = {};

    private constructor(
        private readonly options: FakeSamlProviderOptions,
        private readonly key: FakeKeyPair,
        private readonly otherKey: FakeKeyPair
    ) {
        this.server = createServer((req, res) => void this.handle(req, res));
    }

    /**
     * The entity id of the provider, which is where it is reached.
     * @returns The entity id.
     * @throws When the provider has not been started.
     */
    get entityId(): string {
        if (this.url == undefined) {
            throw new Error('The fake identity provider has not been started.');
        }
        return this.url;
    }

    /**
     * The url of the provider's metadata.
     * @returns The url.
     */
    get metadataUrl(): string {
        return `${this.entityId}/metadata`;
    }

    /**
     * The url the provider signs users in at.
     * @returns The url.
     */
    get signInUrl(): string {
        return `${this.entityId}/sso`;
    }

    /**
     * The url the provider takes logout requests at.
     * @returns The url.
     */
    get logoutUrl(): string {
        return `${this.entityId}/slo`;
    }

    /**
     * The certificate the provider signs with, PEM encoded.
     * @returns The certificate.
     */
    get certificate(): string {
        return this.key.certificate;
    }

    /**
     * Makes the keys of a provider, which is not yet listening.
     * @param options - The service provider it knows, and how it answers.
     * @returns The provider.
     */
    static async create(options: FakeSamlProviderOptions): Promise<FakeSamlProvider> {
        return new FakeSamlProvider(
            options,
            await createFakeKeyPair('CN=Fake identity provider'),
            await createFakeKeyPair('CN=Somebody else')
        );
    }

    /**
     * Starts listening on a free port of the loopback interface.
     */
    async listen(): Promise<void> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        const address: AddressInfo | string | null = this.server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('The fake identity provider is not listening on a port.');
        }
        this.url = `http://127.0.0.1:${address.port}`;
    }

    /**
     * Answers the next sign-in with the given second level status rather than signing the user in, as
     * a provider does when the user is refused.
     * @param status - The status, eg. `urn:oasis:names:tc:SAML:2.0:status:RequestDenied`.
     */
    denyNext(status: string): void {
        this.deniedWith = status;
    }

    /**
     * Gets the next answer wrong in the given ways, to see that the application refuses it.
     * @param changes - What to get wrong.
     */
    changeNextAnswer(changes: FakeSamlAnswerChanges): void {
        this.nextChanges = changes;
    }

    /**
     * The url a user logging out at the provider has their browser sent to: the logout route of the
     * service provider, with a logout request.
     * @param options - Who to log out, and what to get wrong.
     * @returns The url.
     * @throws When the provider was started without the logout url of the service provider.
     */
    createLogoutRequestUrl(options: FakeSamlLogoutOptions): string {
        const destination: string = this.resolveServiceProviderLogoutUrl();
        const request: string = this.createLogoutRequest(options, destination, true);
        return this.toRedirectUrl(destination, 'SAMLRequest', request, undefined, this.resolveLogoutKey(options));
    }

    /**
     * The form a user logging out at the provider has their browser post: the logout route of the
     * service provider, with a logout request signed inside, as the HTTP-POST binding sends it.
     * @param options - Who to log out, and what to get wrong.
     * @returns The form.
     * @throws When the provider was started without the logout url of the service provider.
     */
    createLogoutRequestForm(options: FakeSamlLogoutOptions): FakeSamlLogoutForm {
        const destination: string = this.resolveServiceProviderLogoutUrl();
        const request: string = this.createLogoutRequest(options, destination, true);
        const key: FakeKeyPair | undefined = this.resolveLogoutKey(options);
        const signed: string = key == undefined ? request : this.sign(request, '/*[local-name(.)=\'LogoutRequest\']', key);
        return { url: destination, fields: new URLSearchParams({ SAMLRequest: Buffer.from(signed).toString('base64') }) };
    }

    /**
     * Sends the service provider a logout request server to server, the way the SOAP binding does: a
     * signed logout request in a SOAP envelope, which declares the namespaces the request uses.
     * @param url - Where the service provider takes logout requests of the SOAP binding.
     * @param options - Who to log out, and what to get wrong.
     * @returns What the service provider answered.
     */
    async sendBackChannelLogout(url: string, options: FakeSamlLogoutOptions): Promise<FakeSamlBackChannelAnswer> {
        const id: string = `_${randomBytes(16).toString('hex')}`;
        const envelope: string = [
            `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}" xmlns:samlp="${PROTOCOL_NAMESPACE}" xmlns:saml="${ASSERTION_NAMESPACE}">`,
            '<soap:Body>',
            this.createLogoutRequest(options, undefined, false, id),
            '</soap:Body>',
            '</soap:Envelope>'
        ].join('');
        const key: FakeKeyPair | undefined = this.resolveLogoutKey(options);
        const path: string = '/*[local-name(.)=\'Envelope\']/*[local-name(.)=\'Body\']/*[local-name(.)=\'LogoutRequest\']';
        const res: Response = await fetch(url, {
            method: 'POST',
            // cspell:disable-next-line
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.TEXT_XML, soapaction: 'http://www.oasis-open.org/committees/security' },
            body: key == undefined ? envelope : this.sign(envelope, path, key)
        });
        const body: string = await res.text();
        const certificate: string | undefined = this.options.requiresRequestsSignedBy;
        return {
            requestId: id,
            status: res.status,
            contentType: res.headers.get(KnownHeader.CONTENT_TYPE) ?? undefined,
            body,
            signed: certificate != undefined && this.isXmlSignedBy(body, certificate)
        };
    }

    /**
     * Stops the provider.
     */
    async stop(): Promise<void> {
        await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url: URL = new URL(req.url ?? '/', this.entityId);
        switch (url.pathname) {
            case '/metadata': {
                this.metadataReads++;
                res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: 'application/samlmetadata+xml' });
                res.end(this.createMetadata());
                return;
            }
            case '/sso': {
                await this.signIn(req.url ?? '', url.searchParams, res);
                return;
            }
            case '/slo': {
                if (req.method === 'POST') {
                    this.receiveLogoutResponse(new URLSearchParams(await this.readBody(req)), res);
                    return;
                }
                this.logOut(req.url ?? '', url.searchParams, res);
                return;
            }
            default: {
                res.writeHead(404);
                res.end();
            }
        }
    }

    private async signIn(rawUrl: string, query: URLSearchParams, res: ServerResponse): Promise<void> {
        const encoded: string | null = query.get('SAMLRequest');
        if (encoded == undefined) {
            this.sendError(res, 'The request has no SAMLRequest.');
            return;
        }
        const xml: string = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
        const signed: boolean = this.isSignedBy(rawUrl, query, this.options.requiresRequestsSignedBy);
        const request: FakeSamlRequest = {
            id: this.readAttribute(xml, 'AuthnRequest', 'ID') ?? '',
            issuer: this.readText(xml, 'Issuer') ?? '',
            assertionConsumerServiceUrl: this.readAttribute(xml, 'AuthnRequest', 'AssertionConsumerServiceURL') ?? '',
            forceAuthn: this.readAttribute(xml, 'AuthnRequest', 'ForceAuthn') === 'true',
            nameIdFormat: this.readAttribute(xml, 'NameIDPolicy', 'Format'),
            relayState: query.get('RelayState') ?? undefined,
            signed
        };
        this.requests.push(request);
        if (request.issuer !== this.options.serviceProviderEntityId) {
            this.sendError(res, `The request comes from ${request.issuer}, which is not a known service provider.`);
            return;
        }
        if (this.options.requiresRequestsSignedBy != undefined && !signed) {
            this.sendError(res, 'The request is not signed.');
            return;
        }

        const changes: FakeSamlAnswerChanges = this.nextChanges;
        this.nextChanges = {};
        const denied: string | undefined = this.deniedWith;
        this.deniedWith = undefined;
        const sessionIndex: string | undefined = denied != undefined || changes.omitAuthnStatement === true
            ? undefined
            : `_${randomBytes(8).toString('hex')}`;
        let response: string = denied == undefined
            ? await this.createSignedResponse(request, changes, sessionIndex)
            : this.createResponse(request, changes, this.createDeniedStatus(denied), '');
        response = changes.tamper?.(response) ?? response;

        const fields: URLSearchParams = new URLSearchParams({ SAMLResponse: Buffer.from(response).toString('base64') });
        if (request.relayState != undefined) {
            fields.set('RelayState', request.relayState);
        }
        this.answers.push({ url: request.assertionConsumerServiceUrl, fields, xml: response, sessionIndex });
        const inputs: string = [...fields.entries()]
            .map(([name, value]) => `<input type="hidden" name="${name}" value="${this.escape(value)}">`)
            .join('');
        res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.HTML });
        res.end([
            `<form method="post" action="${this.escape(request.assertionConsumerServiceUrl)}">${inputs}</form>`,
            '<script>document.forms[0].submit()</script>'
        ].join(''));
    }

    // ends the session and sends the browser back to the service provider with a signed answer
    private logOut(rawUrl: string, query: URLSearchParams, res: ServerResponse): void {
        const encoded: string | null = query.get('SAMLRequest');
        if (encoded == undefined) {
            this.sendError(res, 'The request has no SAMLRequest.');
            return;
        }
        const xml: string = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
        const request: FakeSamlLogoutRequest = {
            id: this.readAttribute(xml, 'LogoutRequest', 'ID') ?? '',
            issuer: this.readText(xml, 'Issuer') ?? '',
            nameId: this.readText(xml, 'NameID') ?? '',
            sessionIndex: this.readText(xml, 'SessionIndex'),
            relayState: query.get('RelayState') ?? undefined,
            signed: this.isSignedBy(rawUrl, query, this.options.requiresRequestsSignedBy)
        };
        this.logoutRequests.push(request);
        if (request.issuer !== this.options.serviceProviderEntityId) {
            this.sendError(res, `The request comes from ${request.issuer}, which is not a known service provider.`);
            return;
        }
        if (this.options.requiresRequestsSignedBy != undefined && !request.signed) {
            this.sendError(res, 'The request is not signed.');
            return;
        }
        if (this.options.serviceProviderLogoutUrl == undefined) {
            this.sendError(res, 'The service provider has no logout url.');
            return;
        }
        const destination: string = this.options.serviceProviderLogoutUrl;
        const response: string = [
            `<samlp:LogoutResponse xmlns:samlp="${PROTOCOL_NAMESPACE}" xmlns:saml="${ASSERTION_NAMESPACE}"`,
            ` ID="_${randomBytes(16).toString('hex')}" Version="2.0" IssueInstant="${new Date().toISOString()}"`,
            ` Destination="${this.escape(destination)}" InResponseTo="${this.escape(request.id)}">`,
            `<saml:Issuer>${this.escape(this.entityId)}</saml:Issuer>`,
            `<samlp:Status><samlp:StatusCode Value="${SUCCESS_STATUS}"/></samlp:Status>`,
            '</samlp:LogoutResponse>'
        ].join('');
        if (this.options.answersLogoutWith === 'post') {
            const signed: string = this.sign(response, '/*[local-name(.)=\'LogoutResponse\']', this.key);
            const fields: URLSearchParams = new URLSearchParams({ SAMLResponse: Buffer.from(signed).toString('base64') });
            if (request.relayState != undefined) {
                fields.set('RelayState', request.relayState);
            }
            this.logoutAnswers.push({ url: destination, fields });
            const inputs: string = [...fields.entries()]
                .map(([name, value]) => `<input type="hidden" name="${name}" value="${this.escape(value)}">`)
                .join('');
            res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.HTML });
            res.end(`<form method="post" action="${this.escape(destination)}">${inputs}</form><script>document.forms[0].submit()</script>`);
            return;
        }
        const location: string = this.toRedirectUrl(destination, 'SAMLResponse', response, request.relayState, this.key);
        res.writeHead(302, { [KnownHeader.LOCATION]: location });
        res.end();
    }

    // what the service provider's page posts after the user logged out at the provider
    private receiveLogoutResponse(fields: URLSearchParams, res: ServerResponse): void {
        const encoded: string | null = fields.get('SAMLResponse');
        if (encoded == undefined) {
            this.sendError(res, 'The form has no SAMLResponse.');
            return;
        }
        const xml: string = Buffer.from(encoded, 'base64').toString('utf8');
        const certificate: string | undefined = this.options.requiresRequestsSignedBy;
        this.logoutResponses.push({
            inResponseTo: this.readAttribute(xml, 'LogoutResponse', 'InResponseTo'),
            status: this.readAttribute(xml, 'StatusCode', 'Value'),
            relayState: fields.get('RelayState') ?? undefined,
            signed: certificate != undefined && this.isXmlSignedBy(xml, certificate)
        });
        res.writeHead(200, { [KnownHeader.CONTENT_TYPE]: MimeType.HTML });
        res.end('<p>Logged out.</p>');
    }

    /**
     * Writes a logout request of the user logging out at the provider.
     * @param options - Who to log out.
     * @param destination - Where it is sent, for a binding that names it.
     * @param declaresNamespaces - Whether the request declares the namespaces it uses itself, rather
     * than an envelope around it.
     * @param id - Its id. A new one, when undefined.
     * @returns The request, unsigned.
     */
    private createLogoutRequest(
        options: FakeSamlLogoutOptions,
        destination: string | undefined,
        declaresNamespaces: boolean,
        id: string = `_${randomBytes(16).toString('hex')}`
    ): string {
        const nameIdFormat: string = this.identity.nameIdFormat ?? UNSPECIFIED_NAME_ID_FORMAT;
        return [
            '<samlp:LogoutRequest',
            declaresNamespaces ? ` xmlns:samlp="${PROTOCOL_NAMESPACE}" xmlns:saml="${ASSERTION_NAMESPACE}"` : '',
            ` ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}"`,
            destination == undefined ? '' : ` Destination="${this.escape(destination)}"`,
            '>',
            `<saml:Issuer>${this.escape(this.entityId)}</saml:Issuer>`,
            `<saml:NameID Format="${this.escape(nameIdFormat)}">${this.escape(options.nameId)}</saml:NameID>`,
            options.sessionIndex == undefined ? '' : `<samlp:SessionIndex>${this.escape(options.sessionIndex)}</samlp:SessionIndex>`,
            '</samlp:LogoutRequest>'
        ].join('');
    }

    private resolveLogoutKey(options: FakeSamlLogoutOptions): FakeKeyPair | undefined {
        if (options.unsigned === true) {
            return undefined;
        }
        return options.signedByAnotherKey === true ? this.otherKey : this.key;
    }

    /**
     * Whether an xml document carries a signature made with the key of the given certificate.
     * @param xml - The document.
     * @param certificate - The certificate, PEM encoded.
     * @returns True when it does.
     */
    private isXmlSignedBy(xml: string, certificate: string): boolean {
        const signature: string | undefined = /<(\w+:)?Signature\b[\S\s]*?<\/\1Signature>/.exec(xml)?.[0];
        if (signature == undefined) {
            return false;
        }
        try {
            const verifier: SignedXml = new SignedXml({ publicCert: certificate });
            verifier.loadSignature(signature);
            return verifier.checkSignature(xml);
        }
        catch {
            return false;
        }
    }

    private async readBody(req: IncomingMessage): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        return Buffer.concat(chunks).toString('utf8');
    }

    /**
     * Puts a message into a url the way the HTTP-Redirect binding does: deflated, and signed over the
     * parameters exactly as they are encoded.
     * @param url - Where the message goes.
     * @param parameter - Whether it is a request or an answer.
     * @param xml - The message.
     * @param relayState - The relay state to carry, if any.
     * @param key - The key to sign with. Not signed, when undefined.
     * @returns The url.
     */
    private toRedirectUrl(
        url: string,
        parameter: 'SAMLRequest' | 'SAMLResponse',
        xml: string,
        relayState: string | undefined,
        key: FakeKeyPair | undefined
    ): string {
        const parts: string[] = [`${parameter}=${encodeURIComponent(deflateRawSync(xml).toString('base64'))}`];
        if (relayState != undefined) {
            parts.push(`RelayState=${encodeURIComponent(relayState)}`);
        }
        if (key != undefined) {
            parts.push(`SigAlg=${encodeURIComponent(SIGNATURE_ALGORITHM)}`);
            const signature: Buffer = sign('sha256', Buffer.from(parts.join('&')), key.privateKey);
            parts.push(`Signature=${encodeURIComponent(signature.toString('base64'))}`);
        }
        return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
    }

    private resolveServiceProviderLogoutUrl(): string {
        if (this.options.serviceProviderLogoutUrl == undefined) {
            throw new Error('The fake identity provider was started without the logout url of the service provider.');
        }
        return this.options.serviceProviderLogoutUrl;
    }

    private createDeniedStatus(status: string): string {
        return [
            '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Responder">',
            `<samlp:StatusCode Value="${this.escape(status)}"/>`,
            '</samlp:StatusCode></samlp:Status>'
        ].join('');
    }

    private async createSignedResponse(
        request: FakeSamlRequest,
        changes: FakeSamlAnswerChanges,
        sessionIndex: string | undefined
    ): Promise<string> {
        const signs: 'assertion' | 'response' | 'both' = this.options.signs ?? 'assertion';
        const key: FakeKeyPair = changes.signedByAnotherKey === true ? this.otherKey : this.key;
        let assertion: string = this.createAssertion(request, changes, sessionIndex);
        if (changes.unsigned !== true && signs !== 'response') {
            assertion = this.sign(assertion, '/*[local-name(.)=\'Assertion\']', key);
        }
        if (this.options.encryptsTo != undefined) {
            const encrypted: string = await this.encrypt(assertion, this.options.encryptsTo);
            assertion = `<saml:EncryptedAssertion xmlns:saml="${ASSERTION_NAMESPACE}">${encrypted}</saml:EncryptedAssertion>`;
        }
        const response: string = this.createResponse(
            request,
            changes,
            `<samlp:Status><samlp:StatusCode Value="${SUCCESS_STATUS}"/></samlp:Status>`,
            assertion
        );
        return changes.unsigned !== true && signs !== 'assertion' ? this.sign(response, '/*[local-name(.)=\'Response\']', key) : response;
    }

    private createResponse(request: FakeSamlRequest, changes: FakeSamlAnswerChanges, status: string, assertion: string): string {
        const inResponseTo: string | undefined = changes.unsolicited === true ? undefined : request.id;
        return [
            '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
            ` ID="_${randomBytes(16).toString('hex')}" Version="2.0" IssueInstant="${new Date().toISOString()}"`,
            ` Destination="${this.escape(request.assertionConsumerServiceUrl)}"`,
            inResponseTo == undefined ? '' : ` InResponseTo="${this.escape(inResponseTo)}"`,
            '>',
            `<saml:Issuer>${this.escape(changes.issuer ?? this.entityId)}</saml:Issuer>`,
            status,
            assertion,
            '</samlp:Response>'
        ].join('');
    }

    private createAssertion(request: FakeSamlRequest, changes: FakeSamlAnswerChanges, sessionIndex: string | undefined): string {
        const now: Date = new Date();
        const notOnOrAfter: string = (changes.notOnOrAfter ?? new Date(now.getTime() + ASSERTION_LIFETIME_IN_MS)).toISOString();
        const inResponseTo: string | undefined = changes.unsolicited === true ? undefined : request.id;
        // a request asking for a new sign-in gets one, which is now
        const authenticatedAt: Date = request.forceAuthn ? now : this.authenticatedAt ?? now;
        const nameIdFormat: string = this.identity.nameIdFormat ?? request.nameIdFormat ?? UNSPECIFIED_NAME_ID_FORMAT;
        const attributes: string = Object.entries(this.identity.attributes)
            .map(([name, value]) => [
                `<saml:Attribute Name="${this.escape(name)}">`,
                ...(Array.isArray(value) ? value : [value]).map(item => `<saml:AttributeValue>${this.escape(item)}</saml:AttributeValue>`),
                '</saml:Attribute>'
            ].join(''))
            .join('');
        return [
            '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
            ` ID="_${randomBytes(16).toString('hex')}" Version="2.0" IssueInstant="${now.toISOString()}">`,
            `<saml:Issuer>${this.escape(changes.issuer ?? this.entityId)}</saml:Issuer>`,
            '<saml:Subject>',
            `<saml:NameID Format="${this.escape(nameIdFormat)}">${this.escape(this.identity.nameId)}</saml:NameID>`,
            '<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">',
            `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${this.escape(request.assertionConsumerServiceUrl)}"`,
            inResponseTo == undefined ? '' : ` InResponseTo="${this.escape(inResponseTo)}"`,
            '/>',
            '</saml:SubjectConfirmation>',
            '</saml:Subject>',
            `<saml:Conditions NotBefore="${new Date(now.getTime() - 60000).toISOString()}" NotOnOrAfter="${notOnOrAfter}">`,
            '<saml:AudienceRestriction>',
            `<saml:Audience>${this.escape(changes.audience ?? this.options.serviceProviderEntityId)}</saml:Audience>`,
            '</saml:AudienceRestriction>',
            '</saml:Conditions>',
            sessionIndex == undefined
                ? ''
                : `<saml:AuthnStatement AuthnInstant="${authenticatedAt.toISOString()}" SessionIndex="${sessionIndex}">`
                    + '<saml:AuthnContext>'
                    + `<saml:AuthnContextClassRef>${PASSWORD_AUTHN_CONTEXT}</saml:AuthnContextClassRef>`
                    + '</saml:AuthnContext>'
                    + '</saml:AuthnStatement>',
            attributes == '' ? '' : `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>`,
            '</saml:Assertion>'
        ].join('');
    }

    /**
     * Signs an element of a document, with the signature inside it.
     * @param xml - The document.
     * @param element - The path of the element, which may lie inside an envelope.
     * @param key - The key to sign with.
     * @returns The document, signed.
     */
    private sign(xml: string, element: string, key: FakeKeyPair): string {
        const signature: SignedXml = new SignedXml({
            privateKey: key.privateKey,
            publicCert: key.certificate,
            signatureAlgorithm: SIGNATURE_ALGORITHM,
            canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM
        });
        signature.addReference({
            xpath: element,
            transforms: [ENVELOPED_SIGNATURE, CANONICALIZATION_ALGORITHM],
            digestAlgorithm: DIGEST_ALGORITHM
        });
        // right after the issuer, which is where SAML has the signature go
        signature.computeSignature(xml, {
            prefix: 'ds',
            location: { reference: `${element}/*[local-name(.)='Issuer']`, action: 'after' }
        });
        return signature.getSignedXml();
    }

    private async encrypt(xml: string, certificate: string): Promise<string> {
        const publicKey: string = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'pem' }).toString();
        return await new Promise<string>((resolve, reject) => {
            encrypt(xml, {
                rsa_pub: publicKey,
                pem: certificate,
                encryptionAlgorithm: 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
                keyEncryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p'
            }, (error, result) => error == undefined ? resolve(result) : reject(error));
        });
    }

    /**
     * Whether a request of the HTTP-Redirect binding is signed with the key of the given certificate.
     * The signature covers the parameters exactly as they were encoded in the url.
     * @param rawUrl - The url as it was requested.
     * @param query - Its parameters.
     * @param certificate - The certificate of the key, if any is required.
     * @returns True when the request is signed with it.
     */
    private isSignedBy(rawUrl: string, query: URLSearchParams, certificate: string | undefined): boolean {
        const signature: string | null = query.get('Signature');
        if (certificate == undefined || signature == undefined) {
            return false;
        }
        const raw: Map<string, string> = new Map(
            (rawUrl.split('?')[1] ?? '').split('&').map(pair => [pair.split('=')[0] ?? '', pair.slice(pair.indexOf('=') + 1)])
        );
        const signedParts: string = ['SAMLRequest', 'RelayState', 'SigAlg']
            .filter(name => raw.has(name))
            .map(name => `${name}=${raw.get(name) ?? ''}`)
            .join('&');
        return verify('sha256', Buffer.from(signedParts), new X509Certificate(certificate).publicKey, Buffer.from(signature, 'base64'));
    }

    private createMetadata(): string {
        const certificate: string = this.key.certificate.replaceAll(/-----[^-]+-----|\s/g, '');
        return [
            `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${this.entityId}" ID="_metadata">`,
            '<md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
            '<md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data>',
            `<ds:X509Certificate>${certificate}</ds:X509Certificate>`,
            '</ds:X509Data></ds:KeyInfo></md:KeyDescriptor>',
            ...(this.options.logoutBindings ?? ['redirect'])
                .map(binding => `<md:SingleLogoutService Binding="${BINDINGS[binding]}" Location="${this.logoutUrl}"/>`),
            '<md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>',
            `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${this.signInUrl}"/>`,
            `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${this.signInUrl}"/>`,
            '</md:IDPSSODescriptor>',
            // what metadata carries beyond what a service provider reads
            '<md:Organization>',
            '<md:OrganizationName xml:lang="en">Fake</md:OrganizationName>',
            '<md:OrganizationDisplayName xml:lang="en">Fake</md:OrganizationDisplayName>',
            `<md:OrganizationURL xml:lang="en">${this.entityId}</md:OrganizationURL>`,
            '</md:Organization>',
            '</md:EntityDescriptor>'
        ].join('');
    }

    private readText(xml: string, element: string): string | undefined {
        return new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>([^<]*)<`).exec(xml)?.[1];
    }

    private readAttribute(xml: string, element: string, attribute: string): string | undefined {
        const tag: string | undefined = new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>`).exec(xml)?.[0];
        return tag == undefined ? undefined : new RegExp(`\\b${attribute}="([^"]*)"`).exec(tag)?.[1];
    }

    private sendError(res: ServerResponse, message: string): void {
        res.writeHead(400, { [KnownHeader.CONTENT_TYPE]: MimeType.HTML });
        res.end(`<p>${this.escape(message)}</p>`);
    }

    private escape(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }
}