import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import type { HashString } from '../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';

/**
 * A provider being connected to the account of a logged in user, before the browser is sent to the provider.
 *
 * Spent once, by the browser that goes on to the provider with it.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class FederatedConnectionCode extends BaseEntity {
    /**
     * The code.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: HashString;

    /**
     * The name of the authenticator the provider is connected through.
     */
    @Property.string()
    provider!: string;

    /**
     * The user the provider is connected to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * Where the browser goes once the provider is connected.
     */
    @Property.string()
    redirectTo!: string;

    /**
     * Whether the identity signs in as the user once it is connected.
     */
    @Property.boolean()
    signIn!: boolean;

    /**
     * The scopes of the provider's apis the connection asks for, whose tokens are kept. Empty when none are.
     */
    @Property.array({ items: { type: 'string' } })
    apiScopes!: string[];

    /**
     * Whether the code has been spent.
     */
    @Property.boolean()
    spent!: boolean;

    /**
     * When the code stops being accepted.
     */
    @Property.date()
    expirationDate!: Date;
}

/**
 * The data to create a connection code.
 */
export class FederatedConnectionCodeCreateData extends OmitClass(FederatedConnectionCode, ['id', 'value']) {
    /**
     * The code, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    value!: string;
}