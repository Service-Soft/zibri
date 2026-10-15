import { randomBytes } from 'node:crypto';

import type { CacheItem, CacheProvider, Profile, SAML } from '@node-saml/node-saml';

import { SamlMetadataEndpoint } from './metadata/saml-metadata-endpoint.model';
import { SamlMetadataEntityDescriptor } from './metadata/saml-metadata-entity-descriptor.model';
import { NodeSaml } from './node-saml.type';
import { SamlIdentityProviderSettings } from './saml-identity-provider-settings.model';
import { SamlIdentityProvider } from './saml-identity-provider.model';
import { SamlKeyPair } from './saml-key-pair.model';
import { SamlLogoutSubject } from './saml-logout-subject.model';
import { SamlNameIdFormat } from './saml-name-id-format.enum';
import { ZibriApplication } from '../../../application/application';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { XmlUtilities } from '../../../document/xml.utilities';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { HttpMethod } from '../../../http/http-method.enum';
import { type HttpClientInterface } from '../../../http-client/http-client.interface';
import { $ts } from '../../../localization/translate.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { optionalPeer } from '../../../utilities/optional-peer.function';
import { UrlUtilities } from '../../../utilities/url.utilities';
import { BaseUser } from '../../models/base-user.model';
import { BaseFederatedAuthenticator } from '../federated/base-federated.authenticator';
import { FederatedAnswerContext } from '../federated/federated-answer-context.model';
import { FederatedMetadata } from '../federated/federated-metadata.model';
import { FederatedProfile } from '../federated/federated-profile.model';
import { FederatedProviderLogout } from '../federated/federated-provider-logout.model';
import { FederatedReauthentication } from '../federated/federated-reauthentication.model';
import { FederatedRouteEndpoint } from '../federated/federated-route-endpoint.model';
import { FederatedSession } from '../federated/federated-session.model';
import { FederatedSignInFailure } from '../federated/federated-sign-in-failure.enum';
import { FederatedSignInStart } from '../federated/federated-sign-in-start.model';
import { FederatedSignInError } from '../federated/federated-sign-in.error';
import { FederatedSignIn } from '../federated/federated-sign-in.model';

/**
 * The binding the browser is sent to the identity provider with: the request in the query of a redirect.
 */
const HTTP_REDIRECT_BINDING: string = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

/**
 * The NameID format of an id that is new for every sign-in, which could never find the user again.
 */
const TRANSIENT_NAME_ID_FORMAT: string = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

/**
 * The second level status an identity provider answers with when the user refused or was refused.
 */
const REQUEST_DENIED_STATUS: string = 'urn:oasis:names:tc:SAML:2.0:status:RequestDenied';

/**
 * How far the clocks of the identity provider and the application may be apart, for the validity
 * window of an assertion.
 */
const ACCEPTED_CLOCK_SKEW_IN_MS: number = Ms.MINUTE;

/**
 * How long the metadata of an identity provider is used before it is read again.
 */
const METADATA_MAX_AGE_IN_MS: number = Ms.DAY;

/**
 * The attributes the email of a user is commonly sent in, by the names different identity providers give it.
 */
const EMAIL_ATTRIBUTES: string[] = [
    'email',
    'mail',
    'urn:oid:0.9.2342.19200300.100.1.3',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
];

/**
 * The attributes the full name of a user is commonly sent in.
 */
const NAME_ATTRIBUTES: string[] = [
    'displayName',
    'name',
    'urn:oid:2.16.840.1.113730.3.1.241',
    'http://schemas.microsoft.com/identity/claims/displayname',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
];

/**
 * The attributes the given name of a user is commonly sent in.
 */
const GIVEN_NAME_ATTRIBUTES: string[] = [
    'givenName',
    'firstName',
    'urn:oid:2.5.4.42',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'
];

/**
 * The attributes the family name of a user is commonly sent in.
 */
const FAMILY_NAME_ATTRIBUTES: string[] = [
    'sn',
    'surname',
    'lastName',
    'urn:oid:2.5.4.4',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'
];

/**
 * The metadata of an identity provider as it was read, and when.
 */
type ReadSettings = {
    /**
     * What the metadata says, or the reading of it while it is underway.
     */
    settings: Promise<SamlIdentityProviderSettings>,
    /**
     * When it was read.
     */
    readAt: number
};

/**
 * Authenticates a user by a sign-in at a SAML 2.0 identity provider, such as Microsoft Entra ID, Okta,
 * ADFS or Keycloak: the browser is sent there with a request, and comes back with a signed answer it
 * posts to the callback.
 *
 * Extend it once for every identity provider, naming the provider, the entity id of the application
 * and where the provider's metadata is. The sign-in itself runs through the routes of `AuthController`,
 * which publish the metadata of the application at `/auth/federated/{name}/metadata`.
 *
 * Only an answer to a request this browser sent is taken. A sign-in the identity provider starts on
 * its own, such as from the tile of the application in its portal, is refused: configure the tile
 * with the authorize route of the provider as its sign-on url.
 */
export abstract class BaseSamlAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseFederatedAuthenticator<RoleType, UserType> {
    /**
     * The entity id of the identity provider, which its answers name as their issuer.
     */
    abstract override readonly issuer: string;

    /**
     * The entity id of the application at the identity provider, eg. `https://app.example.com/saml`.
     * Answers are only taken when they are meant for it.
     */
    abstract readonly entityId: string;

    /**
     * Where the identity provider's metadata is, or where it signs users in and what it signs with.
     */
    abstract readonly identityProvider: SamlIdentityProvider;

    /**
     * Which NameID the identity provider is asked for, which links the user to an account.
     */
    readonly nameIdFormat: SamlNameIdFormat = SamlNameIdFormat.PERSISTENT;

    /**
     * The key requests to the identity provider are signed with, for a provider that asks for signed
     * requests. None by default.
     */
    readonly signingKey: SamlKeyPair | undefined = undefined;

    /**
     * The key the identity provider encrypts its assertions to, for a provider that encrypts them.
     * None by default.
     */
    readonly decryptionKey: SamlKeyPair | undefined = undefined;

    // the logout route as well, which the metadata names for the identity provider's single logout,
    // and which the browser is redirected to there
    override get routes(): FederatedRouteEndpoint[] {
        return [...super.routes, { route: 'logout', method: HttpMethod.GET }];
    }

    /**
     * The metadata of the identity provider as it was last read. Dropped when reading it failed and
     * nothing was read before, so the next sign-in tries again.
     */
    private readSettings: ReadSettings | undefined;

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    override init(app: ZibriApplication): void {
        super.init(app);
        this.resolveNodeSaml();
        const urls: string[] = 'metadataUrl' in this.identityProvider
            ? [this.identityProvider.metadataUrl]
            : [this.identityProvider.signInUrl, ...this.identityProvider.logoutUrl == undefined ? [] : [this.identityProvider.logoutUrl]];
        for (const url of urls) {
            this.validateProviderUrl(url);
        }
        // a logout here sends the browser on to the identity provider, which sends it back to land here
        if (this.resolveOptions().signedOutUrl == undefined) {
            throw new InternalError(`${this.constructor.name} needs FEDERATION_OPTIONS to name a signedOutUrl, where a logout lands.`);
        }
        if ('certificates' in this.identityProvider && !this.identityProvider.certificates.length) {
            throw new InternalError(
                `${this.constructor.name} names no certificate of the identity provider, so no answer could be verified.`
            );
        }
    }

    /**
     * The metadata of the application as a SAML service provider, which the identity provider is set
     * up with: its entity id, the callback the answers are posted to, the NameID it asks for and the
     * certificates of its keys.
     * @returns The metadata document.
     */
    override resolveMetadata(): FederatedMetadata {
        return {
            content: this.resolveNodeSaml().generateServiceProviderMetadata({
                issuer: this.entityId,
                callbackUrl: this.getCallbackUrl(),
                logoutCallbackUrl: this.resolveRouteUrl('logout'),
                identifierFormat: this.nameIdFormat,
                wantAssertionsSigned: true,
                // node-saml names a certificate only together with its key, which tells it the key is
                // in use. Neither key is written into the document, which is not signed
                privateKey: this.signingKey?.privateKey,
                publicCerts: this.signingKey?.certificate,
                decryptionPvk: this.decryptionKey?.privateKey,
                decryptionCert: this.decryptionKey?.certificate
            }),
            mimeType: 'application/samlmetadata+xml'
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveFormPostOrigins(): Promise<string[]> {
        return [new URL((await this.resolveSettings()).signInUrl).origin];
    }

    /**
     * The url at the identity provider that ends its session a login was started from: its single logout
     * url, with a logout request naming the user and the session.
     * @param session - The session the login kept.
     * @returns The url, or undefined when the identity provider has no single logout url.
     */
    override async createLogoutUrl(session: FederatedSession): Promise<string | undefined> {
        const settings: SamlIdentityProviderSettings = await this.resolveSettings();
        if (settings.logoutUrl == undefined || session.logout == undefined) {
            return undefined;
        }
        const subject: SamlLogoutSubject = this.toLogoutSubject(session.logout);
        const profile: Profile = {
            issuer: this.issuer,
            nameID: subject.nameID,
            nameIDFormat: subject.nameIDFormat,
            nameQualifier: subject.nameQualifier,
            spNameQualifier: subject.spNameQualifier,
            sessionIndex: subject.sessionIndex
        };
        return await this.createSaml(settings, `_${randomBytes(20).toString('hex')}`, false).getLogoutUrlAsync(profile, '', {});
    }

    /**
     * Reads what the identity provider sent the browser to the logout route with: a signed logout
     * request when the user logged out there, or the answer to a logout request sent from here.
     * @param query - The query of the request.
     * @param rawQuery - The query exactly as it was sent, which the signature covers.
     * @returns What the identity provider said.
     * @throws FederatedSignInError when it is not signed by the identity provider or names another issuer.
     */
    override async readProviderLogout(query: URLSearchParams, rawQuery: string): Promise<FederatedProviderLogout> {
        const settings: SamlIdentityProviderSettings = await this.resolveSettings();
        const isRequest: boolean = query.has('SAMLRequest');
        // node-saml takes a logout request without a signature, which would let anybody send a user a
        // link that ends the logins of whoever they name
        if (isRequest && (!query.has('Signature') || !query.has('SigAlg'))) {
            throw new UnauthorizedError($ts`The logout request is not signed.`);
        }
        // the answer to a logout from here names a request that is not kept anywhere: what the browser
        // lands on is the application's own page either way, so it is taken without it
        const saml: SAML = this.createSaml(settings, `_${randomBytes(20).toString('hex')}`, false, false);
        let profile: Profile | null;
        try {
            ({ profile } = await saml.validateRedirectAsync(Object.fromEntries(query), rawQuery));
        }
        catch (error) {
            throw new UnauthorizedError($ts`The logout could not be verified.`, { cause: error });
        }
        if (!isRequest) {
            return { type: 'response' };
        }
        if (profile?.issuer !== this.issuer || !profile.nameID) {
            throw new UnauthorizedError($ts`The logout could not be verified.`);
        }
        const redirectTo: string = await saml.getLogoutResponseUrlAsync(profile, query.get('RelayState') ?? '', {}, true);
        return { type: 'request', session: this.resolveSessionKeys(profile.nameID, profile.sessionIndex), redirectTo };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async createSignInUrl(start: FederatedSignInStart): Promise<string> {
        const settings: SamlIdentityProviderSettings = await this.resolveSettings();
        const saml: SAML = this.createSaml(settings, this.toRequestId(start.binding), start.reauthenticate);
        return await saml.getAuthorizeUrlAsync(start.state, undefined, {});
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async verifyAnswer(
        answer: URLSearchParams,
        context: FederatedAnswerContext
    ): Promise<FederatedSignIn | FederatedReauthentication> {
        const response: string | null = answer.get('SAMLResponse');
        if (response == undefined) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action: context.action });
        }
        let settings: SamlIdentityProviderSettings;
        try {
            settings = await this.resolveSettings();
        }
        catch (error) {
            throw new FederatedSignInError(FederatedSignInFailure.PROVIDER_ERROR, { cause: error, action: context.action });
        }
        let profile: Profile | null;
        try {
            // the request id was worked out from the cookie of this browser, so an answer to another
            // browser's request - or to none at all - is refused here
            const saml: SAML = this.createSaml(settings, this.toRequestId(context.binding), false);
            ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: response }));
        }
        catch (error) {
            throw new FederatedSignInError(this.toFailure(error), { cause: error, action: context.action });
        }
        if (profile == undefined) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action: context.action });
        }
        return this.toSignIn(profile, context);
    }

    protected override readState(answer: URLSearchParams): string | null {
        return answer.get('RelayState');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected answersWithFormPost(): boolean {
        return true;
    }

    /**
     * Reads the email and the names out of the attributes the identity provider sent along. Override
     * it for a provider that names them differently.
     *
     * A SAML identity provider does not say whether it verified an email, so `emailVerified` is
     * undefined: whether to trust it is up to how the provider is run.
     * @param profile - What the identity provider sent about the user, attributes included.
     * @returns The email and the names.
     */
    protected resolveProfile(profile: Profile): FederatedProfile {
        return {
            email: this.findAttribute(profile, EMAIL_ATTRIBUTES),
            emailVerified: undefined,
            name: this.findAttribute(profile, NAME_ATTRIBUTES),
            givenName: this.findAttribute(profile, GIVEN_NAME_ATTRIBUTES),
            familyName: this.findAttribute(profile, FAMILY_NAME_ATTRIBUTES)
        };
    }

    /**
     * Reads the first value of the first of the attributes the identity provider sent.
     * @param profile - What the identity provider sent about the user.
     * @param names - The names the attribute may have.
     * @returns The value, or undefined when none of them was sent.
     */
    protected findAttribute(profile: Profile, names: string[]): string | undefined {
        for (const name of names) {
            const value: unknown = profile[name];
            const first: unknown = Array.isArray(value) ? value[0] : value;
            if (typeof first === 'string' && first !== '') {
                return first;
            }
        }
        return undefined;
    }

    /**
     * Loads `@node-saml/node-saml`, which is an optional peer.
     * @returns The module.
     * @throws When it is not installed.
     */
    protected resolveNodeSaml(): NodeSaml {
        return optionalPeer<NodeSaml>('@node-saml/node-saml', 'Sign-in through a SAML identity provider');
    }

    private toSignIn(profile: Profile, context: FederatedAnswerContext): FederatedSignIn | FederatedReauthentication {
        // the identity provider's own answer, signed: one by another identity provider whose
        // certificate happens to be configured would otherwise be taken for this one's
        if (profile.issuer !== this.issuer) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action: context.action });
        }
        // a transient NameID is new for every sign-in, so it would link a new identity each time
        if (!profile.nameID || profile.nameIDFormat === TRANSIENT_NAME_ID_FORMAT) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action: context.action });
        }
        const authenticatedAt: Date | undefined = this.findAuthnInstant(profile);
        if (authenticatedAt == undefined) {
            throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action: context.action });
        }
        // SAML has no way to tell the provider how old a sign-in may be, so an older one is asked for
        // again rather than refused: the user signs in once more and lands where they wanted
        if (Date.now() - authenticatedAt.getTime() > context.maxAuthenticationAgeInMs) {
            return { reauthenticate: true };
        }
        const logout: SamlLogoutSubject = {
            nameID: profile.nameID,
            nameIDFormat: profile.nameIDFormat,
            nameQualifier: profile.nameQualifier,
            spNameQualifier: profile.spNameQualifier,
            sessionIndex: profile.sessionIndex
        };
        return {
            identity: { issuer: this.issuer, subject: profile.nameID, authenticatedAt, profile: this.resolveProfile(profile) },
            tokens: undefined,
            session: { id: profile.sessionIndex, logout: JsonUtilities.stringify(logout) }
        };
    }

    /**
     * Reads when the user signed in at the identity provider, from the authentication statement of the
     * assertion.
     * @param profile - What the identity provider sent about the user.
     * @returns The time, or undefined when the assertion does not say.
     */
    private findAuthnInstant(profile: Profile): Date | undefined {
        const assertion: unknown = profile.getAssertion?.()['Assertion'];
        if (typeof assertion !== 'object' || assertion == undefined || !('AuthnStatement' in assertion)) {
            return undefined;
        }
        const statements: unknown = assertion.AuthnStatement;
        const statement: unknown = Array.isArray(statements) ? statements[0] : undefined;
        if (typeof statement !== 'object' || statement == undefined || !('$' in statement)) {
            return undefined;
        }
        const attributes: unknown = statement.$;
        if (typeof attributes !== 'object' || attributes == undefined || !('AuthnInstant' in attributes)) {
            return undefined;
        }
        const instant: unknown = attributes.AuthnInstant;
        const date: Date = new Date(typeof instant === 'string' ? instant : Number.NaN);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }

    /**
     * Reads back what a login kept to end its session at the identity provider.
     * @param logout - What the login kept.
     * @returns The user and the session the logout request names.
     * @throws InternalError when it is not what a sign-in through this authenticator keeps.
     */
    private toLogoutSubject(logout: string): SamlLogoutSubject {
        const value: unknown = JsonUtilities.parse(logout);
        const field: (name: string) => unknown = name => typeof value === 'object' && value != undefined && name in value
            ? Object.entries(value).find(([key]) => key === name)?.[1]
            : undefined;
        const optional: (name: string) => string | undefined = name => {
            const found: unknown = field(name);
            return typeof found === 'string' ? found : undefined;
        };
        const nameID: unknown = field('nameID');
        const nameIDFormat: unknown = field('nameIDFormat');
        if (typeof nameID !== 'string' || typeof nameIDFormat !== 'string') {
            throw new InternalError(`${this.constructor.name} was handed a session it did not keep.`);
        }
        return {
            nameID,
            nameIDFormat,
            nameQualifier: optional('nameQualifier'),
            spNameQualifier: optional('spNameQualifier'),
            sessionIndex: optional('sessionIndex')
        };
    }

    private toFailure(error: unknown): FederatedSignInFailure {
        const { SamlStatusError } = this.resolveNodeSaml();
        if (!(error instanceof SamlStatusError)) {
            return FederatedSignInFailure.INVALID;
        }
        // the status is the identity provider's own word, which it signs only sometimes - so it says
        // why the user is not signed in, never that they are
        return error.xmlStatus.includes(REQUEST_DENIED_STATUS) ? FederatedSignInFailure.CANCELLED : FederatedSignInFailure.PROVIDER_ERROR;
    }

    /**
     * The id of the request the browser is sent to the identity provider with, which its answer has to
     * name. Worked out from the cookie of the sign-in, the way an OpenID Connect nonce is, so nothing
     * has to be stored and only the browser holding the cookie can complete the sign-in.
     * @param binding - The secret of the cookie.
     * @returns The id, starting with an underscore since an XML id cannot start with a digit.
     */
    private toRequestId(binding: string): string {
        return `_${this.deriveFromBinding(binding, 'saml-request')}`;
    }

    private createSaml(
        settings: SamlIdentityProviderSettings,
        requestId: string,
        forceAuthn: boolean,
        validatesInResponseTo: boolean = true
    ): SAML {
        const { SAML, ValidateInResponseTo } = this.resolveNodeSaml();
        return new SAML({
            callbackUrl: this.getCallbackUrl(),
            entryPoint: settings.signInUrl,
            logoutUrl: settings.logoutUrl,
            logoutCallbackUrl: this.resolveRouteUrl('logout'),
            issuer: this.entityId,
            audience: this.entityId,
            idpCert: settings.certificates,
            idpIssuer: this.issuer,
            identifierFormat: this.nameIdFormat,
            forceAuthn,
            // asking for a password-protected sign-in turns away one with a passkey, a smart card or
            // windows authentication, which is the identity provider's to decide
            disableRequestedAuthnContext: true,
            // either the whole response or the assertion has to be signed, and whichever is checked
            // covers the assertion. Both are what identity providers commonly sign
            wantAssertionsSigned: false,
            wantAuthnResponseSigned: false,
            // an answer has to name the request this browser sent, which turns away one the identity
            // provider sends on its own and one meant for another browser
            validateInResponseTo: validatesInResponseTo ? ValidateInResponseTo.always : ValidateInResponseTo.never,
            requestIdExpirationPeriodMs: Number.MAX_SAFE_INTEGER,
            cacheProvider: this.createRequestCache(requestId),
            generateUniqueId: () => requestId,
            acceptedClockSkewMs: ACCEPTED_CLOCK_SKEW_IN_MS,
            ...this.signingKey == undefined ? {} : { privateKey: this.signingKey.privateKey, signatureAlgorithm: 'sha256' },
            ...this.decryptionKey == undefined ? {} : { decryptionPvk: this.decryptionKey.privateKey }
        });
    }

    /**
     * What node-saml asks whether an answer names a request that was sent: only the one worked out from
     * this browser's cookie. Nothing is stored, since the attempt the answer completes is spent once
     * already, and how long it lives is that attempt's.
     * @param requestId - The id of the request this browser sent.
     * @returns The cache.
     */
    private createRequestCache(requestId: string): CacheProvider {
        // null rather than undefined, which is what node-saml's interface says nothing is found as
        return {
            saveAsync: (_key: string, value: string): Promise<CacheItem | null> => Promise.resolve({ value, createdAt: Date.now() }),
            // eslint-disable-next-line unicorn/no-null
            getAsync: (key: string): Promise<string | null> => Promise.resolve(key === requestId ? new Date().toISOString() : null),
            // eslint-disable-next-line unicorn/no-null
            removeAsync: (): Promise<string | null> => Promise.resolve(null)
        };
    }

    /**
     * Where the identity provider signs users in and what it signs with, read from its metadata when it
     * is given as a url.
     *
     * Read again once a day, so a certificate the provider rotates is picked up. When reading it again
     * fails, the metadata read before is used until it can be read.
     * @returns The settings.
     * @throws When the metadata cannot be read and was never read before.
     */
    private async resolveSettings(): Promise<SamlIdentityProviderSettings> {
        const provider: SamlIdentityProvider = this.identityProvider;
        if (!('metadataUrl' in provider)) {
            return { signInUrl: provider.signInUrl, certificates: provider.certificates, logoutUrl: provider.logoutUrl };
        }
        const previous: ReadSettings | undefined = this.readSettings;
        if (previous != undefined && Date.now() - previous.readAt < METADATA_MAX_AGE_IN_MS) {
            return await previous.settings;
        }
        // one reading for every sign-in that needs it meanwhile
        const reading: ReadSettings = { settings: this.readMetadata(provider.metadataUrl), readAt: Date.now() };
        this.readSettings = reading;
        try {
            return await reading.settings;
        }
        catch (error) {
            if (previous == undefined) {
                this.readSettings = undefined;
                throw error;
            }
            this.logger.warn(
                `${this.constructor.name} could not read the metadata of the identity provider again, and uses what it read before.`,
                { error }
            );
            this.readSettings = previous;
            return await previous.settings;
        }
    }

    private async readMetadata(metadataUrl: string): Promise<SamlIdentityProviderSettings> {
        const http: HttpClientInterface = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
        const res: Response = await http.fetchForLibrary(metadataUrl, { method: 'GET' });
        if (!res.ok) {
            throw new InternalError(`The metadata of the identity provider of ${this.constructor.name} answered with ${res.status}.`);
        }
        const metadata: SamlMetadataEntityDescriptor = await XmlUtilities.parseFrom(
            SamlMetadataEntityDescriptor,
            await res.text(),
            { allowAdditionalProperties: true }
        );
        // a document about another entity is a wrong url, and taking its keys would trust whoever that is
        if (metadata.entityId !== this.issuer) {
            throw new InternalError(`The metadata at ${metadataUrl} is about ${metadata.entityId}, not about ${this.issuer}.`);
        }
        const signInUrl: string | undefined = this.findRedirectLocation(metadata.identityProvider?.signInServices ?? []);
        if (signInUrl == undefined) {
            throw new InternalError(`The metadata at ${metadataUrl} names no single sign-on url for the HTTP-Redirect binding.`);
        }
        const certificates: string[] = (metadata.identityProvider?.keys ?? [])
            .filter(key => key.use == undefined || key.use === 'signing')
            .flatMap(key => key.keyInfo.x509Data ?? [])
            .flatMap(data => data.certificates)
            .map(certificate => this.toPem(certificate));
        if (!certificates.length) {
            throw new InternalError(`The metadata at ${metadataUrl} names no signing certificate.`);
        }
        this.validateProviderUrl(signInUrl);
        const logoutUrl: string | undefined = this.findRedirectLocation(metadata.identityProvider?.logoutServices ?? []);
        if (logoutUrl != undefined) {
            this.validateProviderUrl(logoutUrl);
        }
        return { signInUrl, certificates, logoutUrl };
    }

    private findRedirectLocation(endpoints: SamlMetadataEndpoint[]): string | undefined {
        return endpoints.find(endpoint => endpoint.binding === HTTP_REDIRECT_BINDING)?.location;
    }

    private toPem(certificate: string): string {
        const body: string = certificate.replaceAll(/\s+/g, '');
        return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END CERTIFICATE-----`;
    }

    /**
     * Refuses a url of the identity provider that is not reached over https, except on the loopback
     * interface where nobody can listen in.
     * @param url - The url.
     * @throws When the url is not https.
     */
    private validateProviderUrl(url: string): void {
        if (!UrlUtilities.isPrivate(new URL(url))) {
            throw new InternalError(`${this.constructor.name} reaches the identity provider at ${url}, which is not https.`);
        }
    }
}