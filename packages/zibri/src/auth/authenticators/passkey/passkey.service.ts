import { randomBytes } from 'node:crypto';

import type { MetadataBLOBPayloadEntry, VerifiedAuthenticationResponse, VerifiedRegistrationResponse } from '@simplewebauthn/server';

import { FIDO_METADATA_SERVICE_ROOT_CERTIFICATES, FIDO_METADATA_SERVICE_URL } from './fido-metadata.service';
import { PasskeyAttestationOptions } from './passkey-attestation-options.model';
import { PasskeyAuthenticationResponse } from './passkey-authentication-response.model';
import { PasskeyCeremony } from './passkey-ceremony.enum';
import { PasskeyChallenge, PasskeyChallengeCreateData } from './passkey-challenge.model';
import { PasskeyCleanupCronJob } from './passkey-cleanup.cron-job';
import { PasskeyCreationOptions } from './passkey-creation-options.model';
import { PasskeyOptions } from './passkey-options.model';
import { PasskeyRegistrationResponse } from './passkey-registration-response.model';
import { PasskeyRegistrationTicket, PasskeyRegistrationTicketCreateData } from './passkey-registration-ticket.model';
import { PasskeyRequestOptions } from './passkey-request-options.model';
import { PasskeyServiceInterface } from './passkey-service.interface';
import { PasskeyAuthenticator } from './passkey.authenticator';
import { Passkey, PasskeyCreateData } from './passkey.model';
import { SimpleWebAuthnHelpers } from './simple-web-authn-helpers.type';
import { SimpleWebAuthn } from './simple-web-authn.type';
import { ZibriApplication } from '../../../application/application';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../../di/errors/no-provider.error';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { CredentialClonedError } from '../../../error-handling/errors/credential-cloned.error';
import { CredentialReusedError } from '../../../error-handling/errors/credential-reused.error';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { $ts } from '../../../localization/translate.function';
import { Newable } from '../../../types/newable.type';
import { optionalPeer } from '../../../utilities/optional-peer.function';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { PasskeyTwoFactorMethod } from '../../2fa/methods/passkey/passkey.two-factor-method';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * The passkey options, with every default filled in.
 */
type ResolvedPasskeyOptions = Required<Omit<PasskeyOptions, 'attestation'>> & {
    /**
     * Which models of device may hold a passkey, when that is restricted.
     */
    attestation: Required<PasskeyAttestationOptions> | undefined
};

/**
 * A challenge that was answered, and what the browser said it answered.
 */
type ClaimedChallenge = {
    /**
     * The challenge as it is stored.
     */
    row: PasskeyChallenge,
    /**
     * The challenge as the browser passed it to the device, base64url encoded.
     */
    value: string
};

/**
 * What a device answered when it created a passkey, once it is verified.
 */
type VerifiedRegistration = NonNullable<VerifiedRegistrationResponse['registrationInfo']>;

/**
 * What the metadata about a model reports when its keys can no longer be trusted (FIDO Metadata
 * Service §3.1.4).
 */
const COMPROMISED_STATUSES: string[] = [
    'USER_VERIFICATION_BYPASS',
    'ATTESTATION_KEY_COMPROMISE',
    'USER_KEY_REMOTE_COMPROMISE',
    'USER_KEY_PHYSICAL_COMPROMISE',
    'REVOKED'
];

/**
 * Default implementation of the passkey service.
 */
@Injectable({ register: 'onUse' })
export class PasskeyService implements PasskeyServiceInterface, OnAppInit {
    // whether users sign up with a passkey, which is what keeps registration tickets. An application
    // taking passkeys only as a second factor declares no table for them
    private signsUp: boolean = false;

    // read when used rather than injected, so that an application without the entities is told to
    // declare them by onAppInit, instead of failing on a repository token while this is built
    private get passkeyRepository(): Repository<Passkey, PasskeyCreateData> {
        return inject(repositoryTokenFor(Passkey));
    }

    private get challengeRepository(): Repository<PasskeyChallenge, PasskeyChallengeCreateData> {
        return inject(repositoryTokenFor(PasskeyChallenge));
    }

    private get ticketRepository(): Repository<PasskeyRegistrationTicket, PasskeyRegistrationTicketCreateData> {
        return inject(repositoryTokenFor(PasskeyRegistrationTicket));
    }

    private get hashService(): HashServiceInterface {
        return inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const signsIn: boolean = app.options.authenticators.some(a => this.isOrExtends(a, PasskeyAuthenticator));
        const secondFactor: boolean = app.options.twoFactorMethods.some(m => this.isOrExtends(m, PasskeyTwoFactorMethod));
        // built in every application, as the default of its token, and only checks anything where
        // passkeys are used
        if (!signsIn && !secondFactor) {
            return;
        }
        optionalPeer('@simplewebauthn/server', 'Passkeys');
        validateEntitiesRegistered(PasskeyService.name, app, Passkey, PasskeyChallenge);
        this.signsUp = signsIn;
        if (signsIn) {
            validateEntitiesRegistered(PasskeyService.name, app, PasskeyRegistrationTicket);
        }
        if (!app.options.cronJobs.includes(PasskeyCleanupCronJob)) {
            app.options.cronJobs.push(PasskeyCleanupCronJob);
        }
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        if (!options.origins.length) {
            throw new InternalError('PASSKEY_OPTIONS name no origin, so no page could use a passkey.');
        }
        if (options.attestation != undefined) {
            optionalPeer('jose', 'Passkey attestation');
            if (!options.attestation.allowedAaguids.length) {
                throw new InternalError('The attestation of PASSKEY_OPTIONS allows no model, so no passkey could be created.');
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startSignIn(): Promise<PasskeyRequestOptions> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        const requestOptions: PasskeyRequestOptions = await this.resolveLibrary().generateAuthenticationOptions({
            rpID: options.relyingPartyId,
            challenge: randomBytes(32),
            // the passkey is the whole proof, so the device has to have verified who holds it
            userVerification: 'required'
        });
        await this.storeChallenge(requestOptions.challenge, { ceremony: PasskeyCeremony.SIGN_IN }, options);
        return requestOptions;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startSignUp(name: string): Promise<PasskeyCreationOptions> {
        return await this.startCreation(PasskeyCeremony.SIGN_UP, name, undefined, new Uint8Array(randomBytes(32)), []);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startConnection(userId: string, name: string): Promise<PasskeyCreationOptions> {
        const passkeys: Passkey[] = await this.findPasskeys(userId, undefined);
        // the account the device keeps the passkey under. The same for every passkey of the user, so
        // a device that holds one already replaces it rather than listing the account twice
        const userHandle: Uint8Array<ArrayBuffer> = new Uint8Array(
            passkeys[0] == undefined ? randomBytes(32) : Buffer.from(passkeys[0].userHandle, 'base64url')
        );
        return await this.startCreation(PasskeyCeremony.CONNECTION, name, userId, userHandle, passkeys);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startSecondFactor(userId: string): Promise<PasskeyRequestOptions> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        const passkeys: Passkey[] = await this.findPasskeys(userId, undefined);
        if (!passkeys.length) {
            throw new BadRequestError($ts`You have no passkey to present.`);
        }
        const requestOptions: PasskeyRequestOptions = await this.resolveLibrary().generateAuthenticationOptions({
            rpID: options.relyingPartyId,
            challenge: randomBytes(32),
            allowCredentials: passkeys.map(p => ({ id: p.credentialId, transports: p.transports })),
            userVerification: 'required'
        });
        await this.storeChallenge(requestOptions.challenge, { ceremony: PasskeyCeremony.SECOND_FACTOR, userId }, options);
        return requestOptions;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async completeSignUp(response: PasskeyRegistrationResponse): Promise<string> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        const [challenge, registration] = await this.verifyRegistration(response, PasskeyCeremony.SIGN_UP, undefined, options);
        if (challenge.userHandle == undefined || challenge.userName == undefined) {
            throw new InternalError(`The sign-up challenge ${challenge.id} names no account.`);
        }
        const ticket: string = randomBytes(32).toString('base64url');
        await this.ticketRepository.create({
            value: ticket,
            userName: challenge.userName,
            credentialId: registration.credential.id,
            publicKey: Buffer.from(registration.credential.publicKey).toString('base64url'),
            counter: registration.credential.counter,
            transports: response.response.transports ?? [],
            aaguid: registration.aaguid,
            userHandle: challenge.userHandle,
            synced: registration.credentialBackedUp,
            authenticatedAt: new Date(),
            spent: false,
            expirationDate: new Date(Date.now() + options.registrationTicketExpiresInMs)
        });
        return ticket;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async completeConnection(userId: string, response: PasskeyRegistrationResponse): Promise<void> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        const [challenge, registration] = await this.verifyRegistration(response, PasskeyCeremony.CONNECTION, userId, options);
        if (challenge.userHandle == undefined) {
            throw new InternalError(`The connection challenge ${challenge.id} names no account.`);
        }
        await this.passkeyRepository.create({
            userId,
            credentialId: registration.credential.id,
            publicKey: Buffer.from(registration.credential.publicKey).toString('base64url'),
            counter: registration.credential.counter,
            transports: response.response.transports ?? [],
            aaguid: registration.aaguid,
            userHandle: challenge.userHandle,
            synced: registration.credentialBackedUp,
            discoverable: this.findDiscoverable(response),
            createdAt: new Date()
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async verifySignIn(response: PasskeyAuthenticationResponse, transaction: Transaction | undefined): Promise<Passkey> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        // spent outside the login's transaction, so a failed login does not give the challenge back for
        // another answer
        const challenge: ClaimedChallenge = await this.claimChallenge(response.response.clientDataJSON, PasskeyCeremony.SIGN_IN, undefined);
        return await this.verifyAssertion(response, challenge.value, undefined, options, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async verifySecondFactor(userId: string, response: PasskeyAuthenticationResponse): Promise<void> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        const challenge: ClaimedChallenge = await this.claimChallenge(
            response.response.clientDataJSON,
            PasskeyCeremony.SECOND_FACTOR,
            userId
        );
        await this.verifyAssertion(response, challenge.value, userId, options, undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRegistrationTicket(ticket: string, transaction: Transaction | undefined): Promise<PasskeyRegistrationTicket> {
        const found: PasskeyRegistrationTicket | undefined = await this.ticketRepository.findOne({
            where: { value: await this.hashService.hash(ticket, { strategy: Sha256HashStrategy }) },
            transaction,
            required: false
        });
        if (found == undefined || found.spent || new Date(found.expirationDate).getTime() <= Date.now()) {
            throw new UnauthorizedError($ts`The ticket is invalid or has expired.`);
        }
        return found;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async linkRegistrationTicket(ticket: string, userId: string, transaction: Transaction | undefined): Promise<void> {
        const found: PasskeyRegistrationTicket = await this.findRegistrationTicket(ticket, transaction);
        if (found.userId != undefined) {
            throw new UnauthorizedError($ts`The ticket is invalid or has expired.`);
        }
        await this.passkeyRepository.create({
            userId,
            credentialId: found.credentialId,
            publicKey: found.publicKey,
            counter: found.counter,
            transports: found.transports,
            aaguid: found.aaguid,
            userHandle: found.userHandle,
            synced: found.synced,
            // a sign-up demands a stored passkey, which the browser refuses to create otherwise
            discoverable: true,
            createdAt: new Date(found.authenticatedAt)
        }, { transaction });
        await this.ticketRepository.updateById(found.id, { userId }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async spendRegistrationTicket(ticket: string, transaction: Transaction | undefined): Promise<PasskeyRegistrationTicket> {
        const found: PasskeyRegistrationTicket = await this.findRegistrationTicket(ticket, transaction);
        // read in the login's transaction, which is where a registration has just added it
        const passkey: Passkey | undefined = found.userId == undefined
            ? undefined
            : await this.passkeyRepository.findOne({
                where: { credentialId: found.credentialId, userId: found.userId },
                transaction,
                required: false
            });
        if (passkey == undefined) {
            throw new UnauthorizedError($ts`No user is linked to this sign-in.`);
        }
        await this.claim(async () => await this.ticketRepository.updateById(
            found.id,
            { spent: true },
            { where: { spent: false }, transaction }
        ));
        return found;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findPasskeys(userId: string, transaction: Transaction | undefined): Promise<Passkey[]> {
        const passkeys: Passkey[] = await this.passkeyRepository.findAll({ where: { userId }, transaction });
        return [...passkeys].sort((a: Passkey, b: Passkey) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removePasskey(userId: string, passkeyId: string, transaction: Transaction | undefined): Promise<void> {
        // throws NotFoundError for a passkey of somebody else, the same as for one that does not exist
        await this.passkeyRepository.findOne({ where: { id: passkeyId, userId }, transaction });
        await this.passkeyRepository.deleteById(passkeyId, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removePasskeys(userId: string): Promise<void> {
        await this.passkeyRepository.deleteAll({ userId });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteExpired(): Promise<void> {
        const now: Date = new Date();
        await Promise.all([
            this.challengeRepository.deleteAll({ expirationDate: { before: now } }),
            ...this.signsUp ? [this.ticketRepository.deleteAll({ expirationDate: { before: now } })] : []
        ]);
    }

    private async startCreation(
        ceremony: PasskeyCeremony.SIGN_UP | PasskeyCeremony.CONNECTION,
        name: string,
        userId: string | undefined,
        userHandle: Uint8Array<ArrayBuffer>,
        excluded: Passkey[]
    ): Promise<PasskeyCreationOptions> {
        const options: ResolvedPasskeyOptions = this.resolveOptions();
        const creationOptions: PasskeyCreationOptions = await this.resolveLibrary().generateRegistrationOptions({
            rpName: options.relyingPartyName,
            rpID: options.relyingPartyId,
            userName: name,
            userDisplayName: name,
            userID: userHandle,
            challenge: randomBytes(32),
            // a device only proves its model when asked to, and asking without checking the answer
            // would only cost users a consent prompt
            attestationType: options.attestation == undefined ? 'none' : 'direct',
            excludeCredentials: excluded.map(p => ({ id: p.credentialId, transports: p.transports })),
            // a passkey the device keeps for the site can be offered at sign-in without being told the
            // account. A sign-up has nothing else to sign in with, so it demands one. A user who is logged
            // in may add a device that stores none, such as an older security key, as a second factor:
            // signing in with it would mean asking who signs in first, which answers whether an address
            // holds an account
            authenticatorSelection: {
                residentKey: ceremony === PasskeyCeremony.SIGN_UP ? 'required' : 'preferred',
                userVerification: 'required'
            }
        });
        await this.storeChallenge(
            creationOptions.challenge,
            { ceremony, userId, userHandle: creationOptions.user.id, userName: name },
            options
        );
        return creationOptions;
    }

    private async storeChallenge(
        challenge: string,
        data: Pick<PasskeyChallengeCreateData, 'ceremony' | 'userId' | 'userHandle' | 'userName'>,
        options: ResolvedPasskeyOptions
    ): Promise<void> {
        await this.challengeRepository.create({
            ...data,
            value: challenge,
            spent: false,
            expirationDate: new Date(Date.now() + options.challengeExpiresInMs)
        });
    }

    /**
     * Spends the challenge the browser says the device answered, which has to be one issued for the
     * ceremony, and for the user when one is given.
     * @param clientDataJSON - What the browser says it asked the device, base64url encoded.
     * @param ceremony - What the challenge has to have been issued for.
     * @param userId - The user it has to have been issued for, if any.
     * @returns The challenge.
     * @throws UnauthorizedError when there is no such challenge, or it expired. CredentialReusedError when
     * it was answered before.
     */
    private async claimChallenge(clientDataJSON: string, ceremony: PasskeyCeremony, userId: string | undefined): Promise<ClaimedChallenge> {
        let value: string;
        try {
            value = this.resolveHelpers().decodeClientDataJSON(clientDataJSON).challenge;
        }
        catch (error) {
            throw new UnauthorizedError($ts`The passkey challenge is invalid or has expired.`, { cause: error });
        }
        const row: PasskeyChallenge | undefined = await this.challengeRepository.findOne({
            where: { value: await this.hashService.hash(value, { strategy: Sha256HashStrategy }), ceremony },
            required: false
        });
        if (row == undefined || new Date(row.expirationDate).getTime() <= Date.now() || (userId != undefined && row.userId !== userId)) {
            throw new UnauthorizedError($ts`The passkey challenge is invalid or has expired.`);
        }
        if (row.spent) {
            throw new CredentialReusedError($ts`The passkey challenge is invalid or has expired.`);
        }
        // spent before the answer is checked, so each challenge gets one answer, right or wrong
        await this.claim(async () => await this.challengeRepository.updateById(row.id, { spent: true }, { where: { spent: false } }));
        return { row, value };
    }

    private async verifyRegistration(
        response: PasskeyRegistrationResponse,
        ceremony: PasskeyCeremony.SIGN_UP | PasskeyCeremony.CONNECTION,
        userId: string | undefined,
        options: ResolvedPasskeyOptions
    ): Promise<[PasskeyChallenge, VerifiedRegistration]> {
        const challenge: ClaimedChallenge = await this.claimChallenge(response.response.clientDataJSON, ceremony, userId);
        let verified: VerifiedRegistrationResponse;
        try {
            verified = await this.resolveLibrary().verifyRegistrationResponse({
                response,
                expectedChallenge: challenge.value,
                expectedOrigin: options.origins,
                expectedRPID: options.relyingPartyId,
                requireUserVerification: true
            });
        }
        catch (error) {
            throw new BadRequestError($ts`The passkey could not be created.`, { cause: error });
        }
        if (!verified.verified) {
            throw new BadRequestError($ts`The passkey could not be created.`);
        }
        if (options.attestation != undefined) {
            await this.validateAttestation(response, verified.registrationInfo, options.attestation);
        }
        return [challenge.row, verified.registrationInfo];
    }

    /**
     * Checks that the device proved its model, that the model is allowed, and that the proof was issued
     * under what the metadata service publishes for the model.
     * @param response - What the browser answered.
     * @param registration - The verified registration.
     * @param attestation - Which models are allowed.
     * @throws ForbiddenError when any of it does not hold.
     */
    private async validateAttestation(
        response: PasskeyRegistrationResponse,
        registration: VerifiedRegistration,
        attestation: Required<PasskeyAttestationOptions>
    ): Promise<void> {
        if (!attestation.allowedAaguids.includes(registration.aaguid)) {
            throw new ForbiddenError($ts`Passkeys on this device are not accepted.`);
        }
        const helpers: SimpleWebAuthnHelpers = this.resolveHelpers();
        // the certificates the device signed its statement with. A device that sent none vouched for
        // itself, which proves no model at all, whatever model it names
        const attestationObject: Uint8Array<ArrayBuffer> = new Uint8Array(Buffer.from(response.response.attestationObject, 'base64url'));
        const certificates: Uint8Array<ArrayBuffer>[] = helpers.decodeAttestationObject(attestationObject)
            .get('attStmt')
            .get('x5c') ?? [];
        if (registration.fmt === 'none' || !certificates.length) {
            throw new ForbiddenError($ts`Passkeys on this device are not accepted.`);
        }
        const entry: MetadataBLOBPayloadEntry | undefined = await inject(ZIBRI_DI_TOKENS.FIDO_METADATA_SERVICE)
            .findEntry(attestation.metadataServiceUrl, attestation.metadataServiceRootCertificates, registration.aaguid);
        const roots: string[] = entry?.metadataStatement?.attestationRootCertificates ?? [];
        if (entry == undefined || entry.statusReports.some(r => COMPROMISED_STATUSES.includes(r.status)) || !roots.length) {
            throw new ForbiddenError($ts`Passkeys on this device are not accepted.`);
        }
        try {
            // without the roots the metadata names, anybody could issue a certificate claiming any model
            await helpers.validateCertificatePath(
                certificates.map(c => helpers.convertCertBufferToPEM(c)),
                roots.map(r => helpers.convertCertBufferToPEM(Buffer.from(r, 'base64')))
            );
        }
        catch (error) {
            throw new ForbiddenError($ts`Passkeys on this device are not accepted.`, { cause: error });
        }
    }

    /**
     * Verifies what a device answered when a passkey was used, and records its signature counter.
     * @param response - What the browser answered.
     * @param challenge - The challenge it answered, base64url encoded.
     * @param userId - The user the passkey has to belong to, if any.
     * @param options - The passkey options.
     * @param transaction - The transaction to record in, if any.
     * @returns The passkey.
     * @throws UnauthorizedError when the answer does not verify. CredentialClonedError when the
     * signature counter went backwards.
     */
    private async verifyAssertion(
        response: PasskeyAuthenticationResponse,
        challenge: string,
        userId: string | undefined,
        options: ResolvedPasskeyOptions,
        transaction: Transaction | undefined
    ): Promise<Passkey> {
        const passkey: Passkey | undefined = await this.passkeyRepository.findOne({
            where: { credentialId: response.id },
            transaction,
            required: false
        });
        if (passkey == undefined || (userId != undefined && passkey.userId !== userId)) {
            throw new UnauthorizedError($ts`The passkey could not be verified.`);
        }
        // the device says which account it signed for, which has to be the one the passkey is of
        if (response.response.userHandle != undefined && response.response.userHandle !== passkey.userHandle) {
            throw new UnauthorizedError($ts`The passkey could not be verified.`);
        }
        let verified: VerifiedAuthenticationResponse;
        try {
            verified = await this.resolveLibrary().verifyAuthenticationResponse({
                response,
                expectedChallenge: challenge,
                expectedOrigin: options.origins,
                expectedRPID: options.relyingPartyId,
                // the counter is compared below rather than by the library, whose error says nothing
                // a caller could tell a cloned device by
                credential: {
                    id: passkey.credentialId,
                    publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
                    counter: 0
                },
                requireUserVerification: true
            });
        }
        catch (error) {
            throw new UnauthorizedError($ts`The passkey could not be verified.`, { cause: error });
        }
        if (!verified.verified) {
            throw new UnauthorizedError($ts`The passkey could not be verified.`);
        }
        const counter: number = verified.authenticationInfo.newCounter;
        // a device that counts never goes back. One that did is a copy, or one whose original went on
        // signing after it was copied. Zero on both sides is a device that does not count, such as a
        // synced passkey
        if ((counter > 0 || passkey.counter > 0) && counter <= passkey.counter) {
            throw new CredentialClonedError($ts`The passkey could not be verified.`);
        }
        await this.passkeyRepository.updateById(
            passkey.id,
            { counter, synced: verified.authenticationInfo.credentialBackedUp, lastUsedAt: new Date() },
            { transaction }
        );
        return passkey;
    }

    /**
     * Finds whether the device stored a new passkey, from what the browser says.
     * @param response - What the browser answered.
     * @returns Whether it did, or undefined when the browser did not say.
     */
    private findDiscoverable(response: PasskeyRegistrationResponse): boolean | undefined {
        // the browser's word, which the device does not sign. It only tells the user which of their
        // passkeys sign in, and grants nothing
        const properties: unknown = response.clientExtensionResults['credProps'];
        if (typeof properties !== 'object' || properties == undefined || !('rk' in properties) || typeof properties.rk !== 'boolean') {
            return undefined;
        }
        return properties.rk;
    }

    private async claim(spend: () => Promise<unknown>): Promise<void> {
        try {
            await spend();
        }
        catch (error) {
            if (!(error instanceof NotFoundError)) {
                throw error;
            }
            // somebody spent it between reading and spending
            throw new CredentialReusedError($ts`The passkey challenge is invalid or has expired.`, { cause: error });
        }
    }

    private isOrExtends(candidate: Newable<unknown>, base: Newable<unknown>): boolean {
        // `unknown` because a construct signature declares no members, so this reads as `any`
        const prototype: unknown = candidate.prototype;
        return candidate === base || prototype instanceof base;
    }

    private resolveOptions(): ResolvedPasskeyOptions {
        const options: PasskeyOptions | undefined = inject(ZIBRI_DI_TOKENS.PASSKEY_OPTIONS);
        if (options == undefined) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.PASSKEY_OPTIONS, []);
        }
        return {
            relyingPartyId: options.relyingPartyId,
            relyingPartyName: options.relyingPartyName,
            origins: options.origins,
            challengeExpiresInMs: options.challengeExpiresInMs ?? 300000,
            registrationTicketExpiresInMs: options.registrationTicketExpiresInMs ?? 1800000,
            attestation: options.attestation == undefined
                ? undefined
                : {
                    allowedAaguids: options.attestation.allowedAaguids,
                    metadataServiceUrl: options.attestation.metadataServiceUrl ?? FIDO_METADATA_SERVICE_URL,
                    metadataServiceRootCertificates: options.attestation.metadataServiceRootCertificates
                        ?? FIDO_METADATA_SERVICE_ROOT_CERTIFICATES
                }
        };
    }

    private resolveLibrary(): SimpleWebAuthn {
        return optionalPeer('@simplewebauthn/server', 'Passkeys');
    }

    private resolveHelpers(): SimpleWebAuthnHelpers {
        return optionalPeer('@simplewebauthn/server/helpers', 'Passkeys');
    }
}