import { BaseEntity } from '../../../../entity/base-entity.model';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../../entity/omit-class.model';
import type { HashString } from '../../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../../hash/strategies/sha256.hash-strategy';

/**
 * One recovery code of a user, which can be presented once in place of their second factor.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class TwoFactorRecoveryCode extends BaseEntity {
    /**
     * The id of the user the code belongs to.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The code.
     *
     * Stored hashed, and findable because the strategy is deterministic: a code is random enough that
     * there is nothing to guess, and it arrives on its own. A database read yields nothing that can be
     * presented back to the api.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    code!: HashString;

    /**
     * Whether the user confirmed they kept the set this code belongs to. Only a confirmed code is
     * accepted.
     */
    @Property.boolean({ default: false })
    confirmed!: boolean;
}

/**
 * The data to create a new recovery code.
 */
export class TwoFactorRecoveryCodeCreateData extends OmitClass(TwoFactorRecoveryCode, ['id', 'code', 'confirmed']) {
    /**
     * The code as it is generated and shown to the user, before the hook hashes it.
     */
    @Property.string({ hash: { strategy: Sha256HashStrategy } })
    code!: string;
}