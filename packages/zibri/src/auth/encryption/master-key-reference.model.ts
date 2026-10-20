import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * Names a master key and the master strategy it is used with, without holding either.
 */
export class MasterKeyReference {
    /**
     * The id of the master key.
     */
    @Property.string()
    keyId!: string;

    /**
     * The name of the master strategy.
     */
    @Property.string()
    strategyName!: string;

    /**
     * The version of the master strategy.
     */
    @Property.string()
    strategyVersion!: string;
}