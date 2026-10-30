import { type EncryptionString } from './encryption.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A key that signs, kept encrypted under the master key and found by its name.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class SigningKey extends BaseEntity {
    /**
     * What the key signs, such as `'chain'`.
     */
    @Property.string({ unique: true })
    name!: string;
    /**
     * The key, encrypted under the master key.
     */
    @Property.string()
    value!: EncryptionString;
}

/**
 * The data a signing key is created with.
 */
export type SigningKeyCreateData = OmitStrict<SigningKey, 'id'>;