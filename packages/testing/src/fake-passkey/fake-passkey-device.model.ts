import { createHash, generateKeyPairSync, JsonWebKey, KeyObject, randomBytes, sign } from 'node:crypto';

import { JsonUtilities, PasskeyAuthenticationResponse, PasskeyCreationOptions, PasskeyCredentialType, PasskeyRegistrationResponse, PasskeyRequestOptions } from 'zibri';

import { CborValue } from './cbor-value.type.ts';
import { CborUtilities } from './cbor.utilities.ts';
import { FakePasskeyAttestation } from './fake-passkey-attestation.model.ts';
import { FakePasskeyDeviceOptions } from './fake-passkey-device-options.model.ts';
import { FakePasskey } from './fake-passkey.model.ts';

/**
 * A passkey the device holds, with the key it signs with.
 */
type HeldPasskey = FakePasskey & {
    /**
     * Signs.
     */
    privateKey: KeyObject
};

/**
 * The bits of the flags byte of authenticator data (WebAuthn §6.1).
 */
enum AuthenticatorFlag {
    USER_PRESENT = 0x01,
    USER_VERIFIED = 0x04,
    BACKUP_ELIGIBLE = 0x08,
    BACKED_UP = 0x10,
    ATTESTED_CREDENTIAL_DATA = 0x40
}

/**
 * The COSE identifier of ES256, the algorithm every passkey of the device uses.
 */
const ES256: number = -7;

/**
 * A device that holds passkeys, such as a security key or a phone, together with the browser that
 * talks to it.
 *
 * It does what a browser and a device do between being handed the options and handing back the
 * answer, without asking anyone anything, so a test can create and use passkeys end to end. Like a
 * browser, it signs for whatever origin it is told the page is on.
 */
export class FakePasskeyDevice {
    /**
     * Whether the device verifies its user, with a fingerprint or a PIN, before it creates or uses the
     * next passkey.
     */
    verifiesUser: boolean;

    private readonly held: HeldPasskey[] = [];
    private readonly aaguid: string;
    private readonly storesPasskeys: boolean;

    constructor(private readonly options: FakePasskeyDeviceOptions = {}) {
        this.aaguid = options.attestation?.aaguid ?? options.aaguid ?? '00000000-0000-0000-0000-000000000000';
        this.verifiesUser = options.verifiesUser ?? true;
        this.storesPasskeys = options.storesPasskeys ?? true;
    }

    /**
     * The passkeys the device holds, in the order they were created.
     * @returns The passkeys.
     */
    get passkeys(): FakePasskey[] {
        return this.held.map(({ id, rpId, userHandle, signCount }) => ({ id, rpId, userHandle, signCount }));
    }

    /**
     * Creates a passkey, as `navigator.credentials.create` does.
     * @param options - What the site asked for.
     * @param origin - The origin of the page that asked.
     * @returns What the browser hands the page.
     * @throws When the device holds one of the passkeys the site excludes, or the site demands a stored
     * passkey of a device that stores none, as a browser refuses then.
     */
    create(options: PasskeyCreationOptions, origin: string): PasskeyRegistrationResponse {
        const rpId: string = options.rp.id ?? new URL(origin).hostname;
        const excluded: string[] = (options.excludeCredentials ?? []).map(c => c.id);
        if (this.held.some(p => p.rpId === rpId && excluded.includes(p.id))) {
            throw new Error('The fake device already holds a passkey for this account.');
        }
        const storageDemanded: boolean = options.authenticatorSelection?.residentKey === 'required'
            || options.authenticatorSelection?.requireResidentKey === true;
        if (storageDemanded && !this.storesPasskeys) {
            throw new Error('The fake device cannot store a passkey, which the site demands.');
        }
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const id: Buffer = randomBytes(16);
        const passkey: HeldPasskey = {
            id: id.toString('base64url'),
            rpId,
            userHandle: options.user.id,
            signCount: 0,
            privateKey
        };
        this.held.push(passkey);

        const clientDataJSON: Buffer = this.toClientData('webauthn.create', options.challenge, origin);
        const authenticatorData: Buffer = Buffer.concat([
            this.toAuthenticatorData(passkey, AuthenticatorFlag.ATTESTED_CREDENTIAL_DATA),
            Buffer.from(this.aaguid.replaceAll('-', ''), 'hex'),
            Buffer.from([id.length >> 8, id.length & 0xFF]),
            id,
            CborUtilities.encode(this.toCoseKey(publicKey))
        ]);
        const attestation: FakePasskeyAttestation | undefined = this.options.attestation;
        // a browser passes the device's attestation on only when the site asks for one
        const attested: boolean = attestation != undefined && options.attestation != undefined && options.attestation !== 'none';
        const statement: Map<string, CborValue> = attested && attestation != undefined
            ? new Map<string, CborValue>([
                ['alg', ES256],
                ['sig', sign('sha256', Buffer.concat([authenticatorData, this.hash(clientDataJSON)]), attestation.privateKey)],
                ['x5c', attestation.certificates]
            ])
            : new Map<string, CborValue>();
        const attestationObject: Buffer = CborUtilities.encode(new Map<string, CborValue>([
            ['fmt', attested ? 'packed' : 'none'],
            ['attStmt', statement],
            ['authData', authenticatorData]
        ]));

        return {
            id: passkey.id,
            rawId: passkey.id,
            response: {
                clientDataJSON: clientDataJSON.toString('base64url'),
                attestationObject: attestationObject.toString('base64url'),
                transports: ['usb']
            },
            // a browser says whether the device stored the passkey when the site asks (WebAuthn §10.1.3)
            clientExtensionResults: options.extensions?.credProps === true ? { credProps: { rk: this.storesPasskeys } } : {},
            type: PasskeyCredentialType.PUBLIC_KEY
        };
    }

    /**
     * Uses a passkey, as `navigator.credentials.get` does.
     * @param options - What the site asked for.
     * @param origin - The origin of the page that asked.
     * @param passkeyId - The passkey the user picks, when the site names none and the device holds
     * several. The first one for the site by default.
     * @returns What the browser hands the page.
     * @throws When the device holds no passkey the site accepts.
     */
    get(options: PasskeyRequestOptions, origin: string, passkeyId?: string): PasskeyAuthenticationResponse {
        const rpId: string = options.rpId ?? new URL(origin).hostname;
        const allowed: string[] | undefined = options.allowCredentials?.map(c => c.id);
        // a device that stores no passkey keeps nothing to offer, and uses one only when the site names it
        const passkey: HeldPasskey | undefined = this.held.find(p => p.rpId === rpId
            && (allowed == undefined ? this.storesPasskeys : allowed.includes(p.id))
            && (passkeyId == undefined || p.id === passkeyId));
        if (passkey == undefined) {
            throw new Error(`The fake device holds no passkey for ${rpId} that the site accepts.`);
        }
        if (this.options.synced !== true) {
            passkey.signCount++;
        }

        const clientDataJSON: Buffer = this.toClientData('webauthn.get', options.challenge, origin);
        const authenticatorData: Buffer = this.toAuthenticatorData(passkey, 0);
        const signature: Buffer = sign('sha256', Buffer.concat([authenticatorData, this.hash(clientDataJSON)]), passkey.privateKey);

        return {
            id: passkey.id,
            rawId: passkey.id,
            response: {
                clientDataJSON: clientDataJSON.toString('base64url'),
                authenticatorData: authenticatorData.toString('base64url'),
                signature: signature.toString('base64url'),
                // only a stored passkey keeps the account it was created for
                userHandle: this.storesPasskeys ? passkey.userHandle : undefined
            },
            clientExtensionResults: {},
            type: PasskeyCredentialType.PUBLIC_KEY
        };
    }

    /**
     * Copies the device with every passkey on it and every count, as somebody who got hold of its keys
     * could.
     * @returns The copy.
     */
    copy(): FakePasskeyDevice {
        const copy: FakePasskeyDevice = new FakePasskeyDevice(this.options);
        copy.verifiesUser = this.verifiesUser;
        copy.held.push(...this.held.map(p => ({ ...p })));
        return copy;
    }

    private toClientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Buffer {
        return Buffer.from(JsonUtilities.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
    }

    private toAuthenticatorData(passkey: HeldPasskey, extraFlags: number): Buffer {
        const synced: number = this.options.synced === true ? AuthenticatorFlag.BACKUP_ELIGIBLE | AuthenticatorFlag.BACKED_UP : 0;
        const verified: number = this.verifiesUser ? AuthenticatorFlag.USER_VERIFIED : 0;
        const counter: Buffer = Buffer.alloc(4);
        counter.writeUInt32BE(passkey.signCount);
        return Buffer.concat([
            this.hash(Buffer.from(passkey.rpId, 'utf8')),
            Buffer.from([AuthenticatorFlag.USER_PRESENT | verified | synced | extraFlags]),
            counter
        ]);
    }

    private toCoseKey(publicKey: KeyObject): Map<number, CborValue> {
        const jwk: JsonWebKey = publicKey.export({ format: 'jwk' });
        if (jwk.x == undefined || jwk.y == undefined) {
            throw new Error('The fake device made a key without coordinates.');
        }
        // kty EC2, alg ES256, crv P-256, then the coordinates (RFC 9053 §7.1.1)
        return new Map<number, CborValue>([
            [1, 2],
            [3, ES256],
            [-1, 1],
            [-2, Buffer.from(jwk.x, 'base64url')],
            [-3, Buffer.from(jwk.y, 'base64url')]
        ]);
    }

    private hash(data: Buffer): Buffer {
        return createHash('sha256')
            .update(data)
            .digest();
    }
}