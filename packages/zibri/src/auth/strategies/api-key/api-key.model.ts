import { ApiKeyAuthenticationMethod } from './api-key-authentication-method.enum';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * An api key of a user, as `ApiKeyAuthStrategy` keeps it. At the token endpoint of the authorization
 * server, the key is a client, whose `client_id` is the key's id.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class ApiKey extends BaseEntity {
    /**
     * The id of the user the key acts as.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * What the key is for, as its holder named it.
     */
    @Property.string()
    name!: string;

    /**
     * The key itself, hashed. Never part of an answer. Null for a key that proves itself some other
     * way than by a secret.
     */
    // findable because the strategy is deterministic - the key arrives on its own, with nothing else
    // in the request to find the row by. The key is random enough that a fast hash is all it needs
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy }, exclude: true, required: false })
    value: HashString | undefined | null;

    /**
     * The roles the key may use. A request made with the key holds those of them the user still has,
     * of their own and through their membership in the tenant the request is for.
     */
    @Property.array({ items: { type: 'string' } })
    roles!: string[];

    /**
     * The tenant the key is bound to: a request made with it for any other tenant is refused. Null for
     * a key that acts in every tenant its user is a member of.
     */
    // a column of a key every tenant shares rather than the tenant of the row: a key is found by its
    // value before anybody knows which tenant the request is for
    @Property.string({ format: 'uuid', required: false })
    tenantId: string | undefined | null;

    /**
     * How the key proves itself.
     */
    @Property.string({ enum: ApiKeyAuthenticationMethod })
    authenticationMethod!: ApiKeyAuthenticationMethod;

    /**
     * The public key the client signs its jwts with, PEM encoded. Null unless the key proves itself
     * by such a jwt.
     */
    @Property.string({ required: false })
    publicKey: string | undefined | null;

    /**
     * The url of the JSON Web Key Set the client signs its jwts with a key of. Null unless the key
     * proves itself by such a jwt.
     */
    @Property.string({ required: false })
    jwksUrl: string | undefined | null;

    /**
     * The SHA-256 thumbprint of the client certificate, base64url encoded. Null unless the key proves
     * itself by a self-signed certificate.
     */
    @Property.string({ required: false })
    certificateThumbprint: string | undefined | null;

    /**
     * Whether every token the key is exchanged for is bound to a DPoP key. Such a key is never sent in
     * the api key header.
     */
    @Property.boolean()
    requireDpop!: boolean;

    /**
     * When the key stops working. Null for a key that works until it is revoked.
     */
    @Property.date({ required: false })
    expiresAt: Date | undefined | null;

    /**
     * When the key was last used: sent itself, exchanged for a token, or by a token it was exchanged
     * for. Exact to `recordUseAfterMs` of `API_KEY_OPTIONS`. Null for a key never used.
     */
    @Property.date({ required: false })
    lastUsedAt: Date | undefined | null;

    /**
     * When the key was created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
}

/**
 * Data for storing a new api key.
 */
export class ApiKeyCreateDto extends OmitClass(ApiKey, ['id', 'value', 'lastUsedAt', 'createdAt']) {
    /**
     * The key as it is handed to its holder, before the hook hashes it. Undefined for a key without a
     * secret.
     */
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy }, required: false })
    value: string | undefined | null;
}