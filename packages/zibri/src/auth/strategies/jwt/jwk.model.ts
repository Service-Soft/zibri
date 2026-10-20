import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * The public half of a key access tokens are signed with, as a JSON Web Key.
 *
 * `n` and `e` describe an RSA key, `crv`, `x` and `y` an elliptic curve key, and `crv` and `x` an
 * Ed25519 key.
 */
export class Jwk {
    /**
     * The key type, `RSA`, `EC` or `OKP`.
     */
    @Property.string()
    kty!: string;

    /**
     * The id a token signed with this key names in its header.
     */
    @Property.string()
    kid!: string;

    /**
     * The algorithm tokens are signed with.
     */
    @Property.string()
    alg!: string;

    /**
     * What the key is for, which is always `sig`.
     */
    @Property.string()
    use!: string;

    /**
     * The modulus of an RSA key.
     */
    @Property.string({ required: false })
    n?: string;

    /**
     * The exponent of an RSA key.
     */
    @Property.string({ required: false })
    e?: string;

    /**
     * The curve of an elliptic curve key.
     */
    @Property.string({ required: false })
    crv?: string;

    /**
     * The x coordinate of an elliptic curve key.
     */
    @Property.string({ required: false })
    x?: string;

    /**
     * The y coordinate of an elliptic curve key.
     */
    @Property.string({ required: false })
    y?: string;
}