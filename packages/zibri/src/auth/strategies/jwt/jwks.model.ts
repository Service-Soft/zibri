import { Jwk } from './jwk.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * A JSON Web Key Set: the public keys access tokens from this application verify against.
 */
export class Jwks {
    /**
     * The key tokens are signed with now, followed by every previous key that still verifies.
     */
    @Property.array({ items: { type: 'object', cls: () => Jwk } })
    keys!: Jwk[];
}