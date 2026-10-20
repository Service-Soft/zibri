import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';

/**
 * The tokens a provider issued for an identity, kept for calling its apis for the user it is linked to.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['identityId']] })
export class OAuthProviderTokens extends BaseEntity {
    /**
     * The identity the tokens were issued for.
     */
    @Property.string({ format: 'uuid' })
    identityId!: string;

    /**
     * The access token the provider's apis are called with.
     */
    @Property.string({ encryption: true })
    accessToken!: string;

    /**
     * The refresh token a new access token is asked for with. Null when the provider issued none.
     */
    @Property.string({ encryption: true, required: false })
    refreshToken: string | undefined | null;

    /**
     * When the access token stops being accepted. Null when the provider did not say.
     */
    @Property.date({ required: false })
    accessTokenExpirationDate: Date | undefined | null;
}

/**
 * The data to create the tokens of an identity.
 */
export class OAuthProviderTokensCreateData extends OmitClass(OAuthProviderTokens, ['id']) {}