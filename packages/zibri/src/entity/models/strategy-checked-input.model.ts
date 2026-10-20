/* eslint-disable jsdoc-js/require-jsdoc */
import { type ArrayPropertyItemMetadataInput, type ArrayPropertyMetadataInput } from './array-property-metadata.model.ts';
import { type OneOfPropertyMetadataInput } from './one-of-property-metadata.model.ts';
import { type AnyStrategyStringPropertyMetadataInput, type StringPropertyMetadataInput } from './string-property-metadata.model.ts';
import { type BaseDecryptOptions, type BaseEncryptOptions, type EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface.ts';
import { type HashStrategyInterface } from '../../auth/hash/strategies/hash-strategy.interface.ts';
import { type Newable } from '../../types/newable.type.ts';
import { type AnyObject } from '../any-object.model.ts';

/**
 * What an array item declared as `Item` may say, with every string in it checked against the encryption
 * and hashing strategy that string names.
 *
 * Each string is checked on its own, so the shapes of one value can each name a different strategy, and
 * the options each one gives are those of its own strategy.
 */
export type StrategyCheckedItemInput<Item> = Item extends { type: 'string' }
    ? StrategyCheckedStringInput<Item> & { type: 'string' }
    : Item extends { type: 'array', items: infer Items }
        // the whole input beside the checked items, so that what else the array says is still checked
        // for names it does not have
        ? ArrayPropertyMetadataInput<AnyStrategyStringPropertyMetadataInput> & { type: 'array', items: StrategyCheckedItemInput<Items> }
        : Item extends { type: 'oneOf', shapes: infer Shapes }
            ? OneOfPropertyMetadataInput<StrategyCheckedShapesInput<Shapes>> & { type: 'oneOf' }
            // nothing else holds a string, so nothing else names a strategy
            : ArrayPropertyItemMetadataInput;

/**
 * What shapes declared as `Shapes` may say, with every string in them checked against the encryption and
 * hashing strategy that string names - see {@link StrategyCheckedItemInput}.
 */
export type StrategyCheckedShapesInput<Shapes> = {
    [Name in keyof Shapes]: Exclude<StrategyCheckedItemInput<Shapes[Name]>, { type: 'oneOf' } | { type: 'file' }>
};

/**
 * What a string declared as `Item` may say, checked against the strategies it names.
 *
 * The data its settings functions are given is typed as nothing, so a function may declare the data it
 * takes as whatever it is: the decorator cannot check that against the class it decorates either.
 */
type StrategyCheckedStringInput<Item> = EncryptionStrategyOf<Item> extends Newable<EncryptionStrategyInterface<
    infer TKey,
    infer TEncryptOptions,
    infer TDecryptOptions
>>
    // asked again rather than constrained in place, because an inferred type cannot name another one
    ? TEncryptOptions extends BaseEncryptOptions<TKey>
        ? TDecryptOptions extends BaseDecryptOptions<TKey>
            ? StringPropertyMetadataInput<never, TKey, TEncryptOptions, TDecryptOptions, HashOptionsOf<Item>>
            : DefaultStrategyStringInput<Item>
        : DefaultStrategyStringInput<Item>
    : DefaultStrategyStringInput<Item>;

/**
 * What a string declared as `Item` may say when it names no encryption strategy: only the options every
 * strategy takes.
 */
type DefaultStrategyStringInput<Item> = StringPropertyMetadataInput<
    never,
    unknown,
    BaseEncryptOptions<unknown>,
    BaseDecryptOptions<unknown>,
    HashOptionsOf<Item>
>;

/**
 * The encryption strategy a string declared as `Item` names, or undefined for the default one.
 */
type EncryptionStrategyOf<Item> = Item extends { encryption?: infer Setting } ? StrategyOf<Setting> : undefined;

/**
 * The options of the hash strategy a string declared as `Item` names, or any options for the default one.
 */
type HashOptionsOf<Item> = Item extends { hash?: infer Setting }
    ? StrategyOf<Setting> extends Newable<HashStrategyInterface<infer THashOptions extends AnyObject>> ? THashOptions : AnyObject
    : AnyObject;

/**
 * The strategy an encryption or hash setting names, directly or through what its function returns.
 */
type StrategyOf<Setting> = Setting extends { strategy: infer Strategy }
    ? Strategy
    : Setting extends (...args: never[]) => infer Result
        ? StrategyOf<Awaited<Result>>
        : undefined;