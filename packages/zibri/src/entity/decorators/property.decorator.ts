import { BaseDecryptOptions, BaseEncryptOptions } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { type NamedShapeValue } from '../../data-source/models/where/one-of-where-filter.model';
import { OneOfWhereFilterUtilities } from '../../data-source/models/where/one-of-where-filter.utilities';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { MetadataInjectionKeys } from '../../utilities/metadata-injection-keys.enum';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BigNumber } from '../../utilities/number.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { ReflectUtilities } from '../../utilities/reflect.utilities';
import { RegexUtilities } from '../../utilities/regex.utilities';
import { AnyObject } from '../any-object.model';
import type { BaseEntity } from '../base-entity.model';
import { ArrayPropertyMetadata, ArrayPropertyMetadataInput, ArrayPropertyItemMetadataInput, ArrayPropertyItemMetadata } from '../models/array-property-metadata.model';
import { BasePropertyMetadata } from '../models/base-property-metadata.model';
import { BelongsToOnePropertyMetadata, BelongsToOnePropertyMetadataInput } from '../models/belongs-to-one-property-metadata.model';
import { BooleanPropertyMetadata, BooleanPropertyMetadataInput } from '../models/boolean-property-metadata.model';
import { DatePropertyMetadata, DatePropertyMetadataInput } from '../models/date-property-metadata.model';
import type { FilePropertyMetadata, FilePropertyMetadataInput, FileSize } from '../models/file-property-metadata.model';
import { HasOnePropertyMetadata, HasOnePropertyMetadataInput } from '../models/has-one-property-metadata.model';
import { ManyToManyPropertyMetadata, ManyToManyPropertyMetadataInput } from '../models/many-to-many-property-metadata.model';
import { ManyToOnePropertyMetadata, ManyToOnePropertyMetadataInput } from '../models/many-to-one-property-metadata.model';
import { NumberFormat, NumberPropertyMetadata, NumberPropertyMetadataInput } from '../models/number-property-metadata.model';
import { ObjectPropertyMetadata, ObjectPropertyMetadataInput } from '../models/object-property-metadata.model';
import { AnyOfShapesMetadata, OneOfPropertyMetadata, OneOfPropertyMetadataInput, OneOfShapeMetadata, OneOfShapeMetadataInput, OneOfShapesMetadataInput } from '../models/one-of-property-metadata.model';
import { OneOf } from '../models/one-of.model';
import { OneToManyPropertyMetadata, OneToManyPropertyMetadataInput } from '../models/one-to-many-property-metadata.model';
import { Relation } from '../models/relation.enum';
import { ShapeType } from '../models/shape-type.model';
import { StrategyCheckedItemInput, StrategyCheckedShapesInput } from '../models/strategy-checked-input.model';
import { AnyStrategyStringPropertyMetadata, AnyStrategyStringPropertyMetadataInput, StoredStringPropertyMetadata, StringPropertyMetadata, StringPropertyMetadataInput, IncomingStringPropertyMetadataInput } from '../models/string-property-metadata.model';
import { declaresUnique } from '../models/unique-declaration.model';
import { UnknownPropertyMetadata, UnknownPropertyMetadataInput } from '../models/unknown-property-metadata.model';

/**
 * The metadata of a property.
 */
export type PropertyMetadata = StoredStringPropertyMetadata
    | NumberPropertyMetadata
    | ObjectPropertyMetadata
    | ArrayPropertyMetadata
    | DatePropertyMetadata
    | BooleanPropertyMetadata
    | FilePropertyMetadata
    | UnknownPropertyMetadata
    | OneOfPropertyMetadata
    | RelationMetadata<BaseEntity>;

/**
 * The metadata of relation properties.
 */
export type RelationMetadata<T extends BaseEntity> = ManyToOnePropertyMetadata<T>
    | OneToManyPropertyMetadata<T>
    | HasOnePropertyMetadata<T>
    | BelongsToOnePropertyMetadata<T>
    | ManyToManyPropertyMetadata<T>;

/**
 * The metadata input to define a property.
 */
export type PropertyMetadataInput = StringPropertyMetadataInput
    | NumberPropertyMetadataInput
    | ObjectPropertyMetadataInput
    | ArrayPropertyMetadataInput
    | DatePropertyMetadataInput
    | FilePropertyMetadataInput
    | BooleanPropertyMetadataInput
    | UnknownPropertyMetadataInput
    | OneOfPropertyMetadataInput;

// /**
//  * The metadata input to define a relation property.
//  */
// export type RelationMetadataInput<T extends BaseEntity> = ManyToOnePropertyMetadataInput<T>
//     | OneToManyPropertyMetadataInput<T>
//     | HasOnePropertyMetadataInput<T>
//     | BelongsToOnePropertyMetadataInput<T>
//     | ManyToManyPropertyMetadataInput<T>;

/**
 * Bundles decorators for properties.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Property {

    /**
     * Defines a string property.
     * @param data - Additional data to specify the property.
     */
    export function string<
        Data,
        TKey,
        TEncryptOptions extends BaseEncryptOptions<TKey>,
        TDecryptOptions extends BaseDecryptOptions<TKey>,
        THashOptions extends AnyObject
    >(data?: StringPropertyMetadataInput<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions>): PropertyDecorator {
        const fullMetadata: StringPropertyMetadata<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions> = {
            required: true,
            primary: false,
            type: 'string',
            unique: false,
            index: false,
            fuzzySearchable: true,
            optimisticLocking: false,
            description: undefined,
            format: data?.primary === true ? 'uuid' : undefined,
            maxLength: undefined,
            minLength: undefined,
            regex: undefined,
            enum: undefined,
            default: undefined,
            // before the spread, so the declaration is still the last word
            excludeFromChangeSets: excludedFromChangeSetsByDefault(data),
            exclude: false,
            encryption: false,
            hash: false,
            ...data
        };
        return applyData(toStoredStringPropertyMetadata(fullMetadata));
    }

    /**
     * Defines a number property.
     * @param data - Additional data to specify the property.
     */
    export function number(data?: NumberPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: NumberPropertyMetadata = {
            required: true,
            primary: false,
            unique: false,
            index: false,
            optimisticLocking: false,
            type: 'number',
            description: undefined,
            min: undefined,
            max: undefined,
            default: undefined,
            excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
            exclude: false,
            enum: undefined,
            format: 'number',
            ...data
        };
        return applyData(fullMetadata);
    }

    /**
     * Defines a boolean property.
     * @param data - Additional data to specify the property.
     */
    export function boolean(data?: BooleanPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: BooleanPropertyMetadata = {
            required: true,
            type: 'boolean',
            index: false,
            optimisticLocking: false,
            description: undefined,
            default: undefined,
            excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
            exclude: false,
            ...data
        };
        return applyData(fullMetadata);
    }

    /**
     * Defines a date property.
     * @param data - Additional data to specify the property.
     */
    export function date(data?: DatePropertyMetadataInput): PropertyDecorator {
        const fullMetadata: DatePropertyMetadata = {
            required: true,
            type: 'date',
            index: false,
            optimisticLocking: false,
            description: undefined,
            after: undefined,
            before: undefined,
            default: undefined,
            exclude: false,
            excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
            ...data
        };
        return applyData(fullMetadata);
    }

    /**
     * Defines an object property.
     * @param data - Additional data to specify the property.
     */
    export function object(data: ObjectPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: ObjectPropertyMetadata = {
            required: true,
            type: 'object',
            description: undefined,
            exclude: false,
            excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
            allowAdditionalProperties: false,
            ...data
        };
        return applyData(fullMetadata);
    }

    /**
     * Defines a file property.
     * @param data - Additional data to specify the property.
     */
    export function file(data: FilePropertyMetadataInput): PropertyDecorator {
        return (target, key) => {
            // no default for allowedMimeTypes: any file type and a list of them are both ordinary
            // answers, and a default made a forgotten one indistinguishable from a chosen one
            const fullMetadata: FilePropertyMetadata = {
                required: true,
                type: 'file',
                description: undefined,
                maxSize: '5mb',
                exclude: false,
                excludeFromChangeSets: typeof data.exclude === 'boolean' ? data.exclude : false,
                ...data
            };
            const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
            MetadataUtilities.setFilePath(ctor);
            const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
            propertyMetadata[key as string] = fullMetadata;
            MetadataUtilities.setModelProperties(ctor, propertyMetadata);
        };
    }

    /**
     * Defines an array property.
     * @param data - Additional data to specify the property.
     */
    export function array<Items extends ArrayPropertyItemMetadataInput<AnyStrategyStringPropertyMetadataInput>>(
        // the items once more as checked, because each string in them names its own strategy: the items of
        // several shapes can name several, and one set of types for all of them fits none.
        // Checked through an index signature rather than as "items: Items & checked": next to the items'
        // own type every name they use is a known one, so a misspelled option would compile. A property
        // compared against an index signature is compared against that alone, and the pattern matches
        // nothing an array declares but its items. One object rather than the union of a file array and
        // any other, because against a union the options inside the items go unchecked for names again
        data: Partial<BasePropertyMetadata>
            & {
                // eslint-disable-next-line jsdoc/require-jsdoc
                items: Items,
                // eslint-disable-next-line jsdoc/require-jsdoc
                totalMaxSize?: Items extends { type: 'file' } ? FileSize : never
            }
            & { [key: `items${string}`]: StrategyCheckedItemInput<Items> }
    ): PropertyDecorator {
        return (target, key) => {
            const fullMetadata: ArrayPropertyMetadata
                = createArrayPropertyMetadata(data, `${target.constructor.name}.${key.toString()}`);
            const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
            MetadataUtilities.setFilePath(ctor);
            const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
            propertyMetadata[key as string] = fullMetadata;
            MetadataUtilities.setModelProperties(ctor, propertyMetadata);
        };
    }

    /**
     * Defines an unknown property.
     * @param data - Additional data to specify the property.
     */
    export function unknown(data?: UnknownPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: UnknownPropertyMetadata = {
            required: true,
            type: 'unknown',
            description: undefined,
            exclude: false,
            excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
            ...data
        };
        return applyData(fullMetadata);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a property that holds one of several named shapes, declared as `OneOf` of the same names.
     *
     * A value names the shape it is, as `{ shape: 'Signup', value: { ... } }`.
     * @param data - The shapes by name, and what the property as a whole is declared with.
     */
    export function oneOf<const Shapes extends OneOfShapesMetadataInput<AnyStrategyStringPropertyMetadataInput>>(
        // the shapes once more as checked, because each string in them names its own strategy and the
        // constraint takes any: one set of types for all the shapes fits none once two name different ones.
        // Checked through an index signature rather than shape by shape: next to the shapes' own type every
        // name they use is a known one, so a misspelled option would compile, and a property compared
        // against an index signature is compared against that alone. Each shape has to be one of the
        // checked shapes, which only lets a shape through as another one's when its strategy is one too
        data: OneOfPropertyMetadataInput<Shapes> & OneOfPropertyMetadataInput<{
            [name: string]: StrategyCheckedShapesInput<Shapes>[keyof Shapes]
        }>
    ) {
        return <Target extends object, Key extends keyof Target & string>(
            target: Target,
            key: Key & MatchingKey<Target, Key, OneOf<{ [Name in keyof Shapes]: ShapeType<Shapes[Name]> }>>
        ): void => {
            applyData(createOneOfPropertyMetadata(data, `${target.constructor.name}.${key}`))(target, key);
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a many to one property.
     * @param metadata - Additional data to specify the property.
     */
    export function manyToOne<T extends BaseEntity, TJoinKey extends string>(
        metadata: ManyToOnePropertyMetadataInput<T, TJoinKey>
    ) {
        const fullMetadata: ManyToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.MANY_TO_ONE,
            cascade: [],
            description: undefined,
            joinColumn: undefined,
            exclude: false,
            excludeFromChangeSets: typeof metadata?.exclude === 'boolean' ? metadata.exclude : false,
            ...metadata
        };

        // eslint-disable-next-line typescript/no-explicit-any
        return <TCurrentEntity extends Partial<Record<TJoinKey, any>>>(
            target: TCurrentEntity,
            propertyKey: string | symbol
        ): void => {
            applyData(fullMetadata as PropertyMetadata)(target, propertyKey);
        };
    }

    /**
     * Defines a one to many property.
     * @param metadata - Additional data to specify the property.
     */
    export function oneToMany<T extends BaseEntity>(metadata: OneToManyPropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: OneToManyPropertyMetadata<T> = {
            required: true,
            type: Relation.ONE_TO_MANY,
            cascade: ['remove', 'insert', 'update'],
            description: undefined,
            exclude: false,
            excludeFromChangeSets: typeof metadata?.exclude === 'boolean' ? metadata.exclude : false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }

    /**
     * Defines a has one property.
     * @param metadata - Additional data to specify the property.
     */
    export function hasOne<T extends BaseEntity>(metadata: HasOnePropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: HasOnePropertyMetadata<T> = {
            required: true,
            type: Relation.HAS_ONE,
            cascade: ['remove', 'insert', 'update'],
            description: undefined,
            exclude: false,
            excludeFromChangeSets: typeof metadata?.exclude === 'boolean' ? metadata.exclude : false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a belongs to one property.
     * @param metadata - Additional data to specify the property.
     */
    export function belongsToOne<T extends BaseEntity, TJoinKey extends string>(
        metadata: BelongsToOnePropertyMetadataInput<T, TJoinKey>
    ) {
        const fullMetadata: BelongsToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.BELONGS_TO_ONE,
            cascade: [],
            joinColumn: undefined,
            description: undefined,
            exclude: false,
            excludeFromChangeSets: typeof metadata?.exclude === 'boolean' ? metadata.exclude : false,
            ...metadata
        };

        // eslint-disable-next-line typescript/no-explicit-any
        return <TCurrentEntity extends Partial<Record<TJoinKey, any>>>(
            target: TCurrentEntity,
            propertyKey: string | symbol
        ): void => {
            applyData(fullMetadata as PropertyMetadata)(target, propertyKey);
        };
    }

    /**
     * Defines a many to many property.
     * @param metadata - Additional data to specify the property.
     */
    export function manyToMany<T extends BaseEntity>(metadata: ManyToManyPropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: ManyToManyPropertyMetadata<T> = {
            required: true,
            type: Relation.MANY_TO_MANY,
            cascade: metadata.joinTable === true ? ['remove'] : [],
            description: undefined,
            joinTable: undefined,
            persistence: true,
            exclude: false,
            excludeFromChangeSets: typeof metadata?.exclude === 'boolean' ? metadata.exclude : false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }
}

/**
 * Stores a string declaration without the types it was declared with.
 * @param declared - The full metadata, checked against its strategies where it was declared.
 * @returns The same metadata, as it is stored and read back.
 */
function toStoredStringPropertyMetadata(declared: AnyStrategyStringPropertyMetadata): StoredStringPropertyMetadata {
    // the one place the declared types are let go of (05 §M3). A strategy's key type sits in a return
    // position and in a parameter position of the strategy, so no type is a supertype of a strategy for
    // every key - TypeScript cannot say "some strategy, and that strategy's options", which is what the
    // declaration checks and what is stored. The decorators check each string against its own strategy
    // and carry it here as unknown; nothing reading the metadata needs the types: the strategy is
    // resolved from its class and only ever handed the key it generated itself, and the settings functions
    // are given the data of the row they were declared on, which the decorator cannot check either
    return declared as StoredStringPropertyMetadata;
}

/**
 * The parts of a property declaration that decide whether a change set may record it.
 */
type RecordableDeclaration = {
    /**
     * Whether the property is kept out of external facing output.
     */
    exclude?: unknown,
    /**
     * The encryption the property declares, when it declares any.
     */
    encryption?: unknown,
    /**
     * The hashing the property declares, when it declares any.
     */
    hash?: unknown
};

/**
 * Whether a property is kept out of change sets unless its declaration says otherwise.
 *
 * A change set is a second copy, in a second table, of every value it records - which is fine for a
 * title and is not fine for a secret. It is also the one place a stored value is written back
 * through the save hooks: `resetSingleChangeSet` sends it down the path that encrypts and hashes,
 * so a recorded ciphertext would be encrypted again and a recorded hash hashed again.
 *
 * A default rather than a rule, because whether a given encrypted column is a secret or merely
 * encrypted at rest is the declaration's call.
 * @param data - The property declaration.
 * @returns True when the property holds something the framework generated to store.
 */
function excludedFromChangeSetsByDefault(data?: RecordableDeclaration): boolean {
    if (data?.encryption != undefined && data.encryption !== false) {
        return true;
    }
    if (data?.hash != undefined && data.hash !== false) {
        return true;
    }
    return typeof data?.exclude === 'boolean' ? data.exclude : false;
}

/**
 * Whether a value of the given declaration holds a string the framework generated to store, as an item
 * of an array or the value of a shape - which keeps the property holding it out of change sets for the
 * reasons {@link excludedFromChangeSetsByDefault} gives for a string property.
 * @param metadata - The items of an array, or a shape.
 * @returns True when a string anywhere in it is encrypted or hashed.
 */
function holdsGeneratedStrings(metadata: ArrayPropertyItemMetadata): boolean {
    switch (metadata.type) {
        case 'string': {
            return excludedFromChangeSetsByDefault({ encryption: metadata.encryption, hash: metadata.hash });
        }
        case 'array': {
            return holdsGeneratedStrings(metadata.items);
        }
        case 'oneOf': {
            return ObjectUtilities.values(metadata.shapes).some(holdsGeneratedStrings);
        }
        case 'number':
        case 'boolean':
        case 'date':
        case 'file':
        case 'unknown':
        case 'object': {
            // an object's own properties are recorded by what it declares, not by the property holding it
            return false;
        }
    }
}

/**
 * What a property of each number format is declared as in TypeScript.
 *
 * Every format is stored as something its type holds exactly, so the type is not a preference:
 * declaring one and naming another is a property that hands back a value of a type nothing said it
 * would.
 */
const TYPE_FOR_NUMBER_FORMAT: Record<NumberFormat, Function> = {
    number: Number,
    integer: Number,
    bigint: BigInt,
    bignumber: BigNumber
};

/**
 * Refuses a number property whose declared type contradicts the format it names.
 *
 * Read off the type TypeScript emits for the property, which it does for a plain declaration -
 * `amount!: number`, `amount?: number` - and not for one written as a union, where `number | null`
 * compiles to `Object`. Silent on those rather than guessing: what a union means is a question this
 * cannot answer, and the value is checked against the format on the way in regardless.
 * @param fullKey - The entity and property this is about, for the message.
 * @param data - The metadata the property was declared with.
 * @param ctor - The class the property is on.
 * @param key - The name of the property.
 * @throws When the declared type is one that can be read and is not the one the format holds.
 */
function validateNumberTypeMatchesFormat(fullKey: string, data: PropertyMetadata, ctor: Newable<unknown>, key: string): void {
    if (data.type !== 'number') {
        return;
    }
    const declared: Function | undefined = ReflectUtilities.getMetadata(MetadataInjectionKeys.TYPE, ctor, key);
    const expected: Function = TYPE_FOR_NUMBER_FORMAT[data.format];
    // Object is what a union compiles to, and undefined is what a build without decorator metadata
    // emits. Neither says the declaration is wrong, so neither is treated as if it did
    if (declared == undefined || declared === Object || declared === expected) {
        return;
    }
    throw new InternalError([
        `${fullKey}: The format "${data.format}" is held by ${expected.name}, and the property is declared as ${declared.name}.`,
        `Declare it as ${expected.name}, or name the format that ${declared.name} holds.`
    ]);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function applyData(data: PropertyMetadata): PropertyDecorator {
    return (target, key) => {
        if ('primary' in data && data.primary && data.exclude !== false) {
            throw new InternalError(`${target.constructor.name}.${key.toString()}: Cannot mark a primary key with "exclude."`);
        }
        validateNotEncryptedAndHashed(`${target.constructor.name}.${key.toString()}`, data);
        validateKeyIsDeclaredOnce(`${target.constructor.name}.${key.toString()}`, data);
        validatePrimaryStringIsUuid(`${target.constructor.name}.${key.toString()}`, data);
        if (data.type === 'string') {
            RegexUtilities.validateLinear(`${target.constructor.name}.${key.toString()}`, data.regex);
        }
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        validateNumberTypeMatchesFormat(`${ctor.name}.${key.toString()}`, data, ctor, key.toString());
        MetadataUtilities.setFilePath(ctor);
        const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
        propertyMetadata[key as string] = data;
        MetadataUtilities.setModelProperties(ctor, propertyMetadata);
    };
}

/**
 * Refuses a string that is declared both encrypted and hashed.
 * @param fullKey - Where the string is declared, for the message.
 * @param data - The declared metadata of the property, item or shape.
 * @throws When both are declared.
 */
function validateNotEncryptedAndHashed(fullKey: string, data: PropertyMetadata): void {
    if (
        'encryption' in data && 'hash' in data
        && data.encryption !== undefined && data.encryption !== false
        && data.hash !== undefined && data.hash !== false
    ) {
        throw new InternalError(`${fullKey}: Cannot set the flags "encryption" and "hash" at the same time.`);
    }
}

/**
 * Refuses a string primary key that is declared to hold something other than uuids.
 * @param fullKey - The class and property the declaration is on, for the message.
 * @param data - The declared property metadata.
 * @throws When a string primary key declares another format, or none.
 */
function validatePrimaryStringIsUuid(fullKey: string, data: PropertyMetadata): void {
    // one kind of string key is what lets every data source store, compare and generate it the same
    // way. A key of another format was a uuid column on one store and free text on the others
    if (data.type !== 'string' || !data.primary || data.format === 'uuid') {
        return;
    }
    const declared: string = data.format == undefined ? 'no format' : `the format "${data.format}"`;
    throw new InternalError([
        `${fullKey}: A string primary key holds uuids, so it cannot declare ${declared}.`,
        'Remove "format" here. A key that is no uuid belongs in a property of its own, declared unique.'
    ]);
}

/**
 * Refuses a property that declares a key it already has.
 *
 * A primary key identifies at most one row and a unique constraint is enforced by an index of its
 * own, so each of these pairs is one declaration doing what the other already does. Refused rather
 * than ignored, because the two readings differ by more than a wasted index: someone who wrote
 * `unique` next to `primary` may have meant a second column to be unique, and someone who wrote
 * `index` next to `unique` may have meant the entity's `indexes` for a lookup over several columns.
 * @param fullKey - The class and property the declaration is on, for the message.
 * @param data - The declared property metadata.
 * @throws When two of `primary`, `unique` and `index` are declared on the same property.
 */
function validateKeyIsDeclaredOnce(fullKey: string, data: PropertyMetadata): void {
    const primary: boolean = 'primary' in data && data.primary;
    const unique: boolean = 'unique' in data && declaresUnique(data.unique);
    const index: boolean = 'index' in data && data.index;

    if (primary && unique) {
        throw new InternalError([
            `${fullKey}: Cannot set the flags "primary" and "unique" at the same time.`,
            'A primary key already names at most one row, so the unique constraint enforces what the key enforces.',
            'Remove "unique" here, or move it to the column that actually has to be unique.'
        ]);
    }
    if (primary && index) {
        throw new InternalError([
            `${fullKey}: Cannot set the flags "primary" and "index" at the same time.`,
            'A primary key is indexed by the constraint that enforces it, so the second index only costs writes and space.',
            'Remove "index" here, or move it to the column the lookup actually goes through.'
        ]);
    }
    if (unique && index) {
        throw new InternalError([
            `${fullKey}: Cannot set the flags "unique" and "index" at the same time.`,
            'A unique constraint is enforced by an index of its own, so the second index only costs writes and space.',
            'Remove "index" here. For a lookup that uses more than this one column, declare it under the entity\'s "indexes".'
        ]);
    }
}

/**
 * Creates full metadata for an array property.
 * @param data - The array as declared.
 * @param fullPropertyKey - The full key of the property, for messages.
 * @returns The full metadata.
 */
export function createArrayPropertyMetadata(
    // one object rather than the union of a file array and any other: which of them it is was the
    // declaration's to check, and nothing here treats the two differently
    data: Partial<BasePropertyMetadata> & {
        // eslint-disable-next-line jsdoc/require-jsdoc
        items: ArrayPropertyItemMetadataInput<AnyStrategyStringPropertyMetadataInput>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        totalMaxSize?: FileSize
    },
    fullPropertyKey: string
): ArrayPropertyMetadata {
    const items: ArrayPropertyItemMetadata = createArrayItemPropertyMetadata(data.items, fullPropertyKey);
    return {
        required: true,
        type: 'array',
        description: undefined,
        exclude: false,
        // before the spread, so the declaration is still the last word
        excludeFromChangeSets: holdsGeneratedStrings(items) || (typeof data.exclude === 'boolean' ? data.exclude : false),
        totalMaxSize: '50mb',
        ...data,
        items
    };
}

/**
 * Creates full metadata for an array property item.
 * @param data - The array item input data.
 * @param fullPropertyKey - The full key of the property.
 * @returns The full metadata.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export function createArrayItemPropertyMetadata(
    data: ArrayPropertyItemMetadataInput<AnyStrategyStringPropertyMetadataInput>,
    fullPropertyKey: string
): ArrayPropertyItemMetadata {
    switch (data.type) {
        case 'number': {
            return {
                required: true,
                primary: false,
                unique: false,
                index: false,
                optimisticLocking: false,
                description: undefined,
                min: undefined,
                max: undefined,
                default: undefined,
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                enum: undefined,
                format: 'number',
                ...data
            };
        }
        case 'string': {
            RegexUtilities.validateLinear(fullPropertyKey, data.regex);
            const item: StoredStringPropertyMetadata = toStoredStringPropertyMetadata({
                required: true,
                primary: false,
                unique: false,
                index: false,
                // a trigram index covers a column, and the values inside an array are not one, so
                // there is nothing here for a search to be answered from
                fuzzySearchable: false,
                optimisticLocking: false,
                format: undefined,
                description: undefined,
                maxLength: undefined,
                minLength: undefined,
                regex: undefined,
                enum: undefined,
                default: undefined,
                exclude: false,
                encryption: false,
                hash: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                ...data
            });
            validateNotEncryptedAndHashed(fullPropertyKey, item);
            return item;
        }
        case 'unknown': {
            return {
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                ...data
            };
        }
        case 'object': {
            return {
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                allowAdditionalProperties: false,
                ...data
            };
        }
        case 'boolean': {
            return {
                required: true,
                index: false,
                optimisticLocking: false,
                description: undefined,
                default: undefined,
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                ...data
            };
        }
        case 'date': {
            return {
                required: true,
                description: undefined,
                index: false,
                optimisticLocking: false,
                after: undefined,
                before: undefined,
                default: undefined,
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                ...data
            };
        }
        case 'array': {
            const metadata: ArrayPropertyMetadata = {
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                totalMaxSize: '50mb',
                ...data,
                items: createArrayItemPropertyMetadata(data.items, fullPropertyKey)
            };
            return metadata;
        }
        case 'file': {
            return {
                required: true,
                description: undefined,
                maxSize: '5mb',
                exclude: false,
                excludeFromChangeSets: typeof data?.exclude === 'boolean' ? data.exclude : false,
                ...data
            };
        }
        case 'oneOf': {
            return createOneOfPropertyMetadata(data, fullPropertyKey);
        }
    }
}

/**
 * The key, when the property's declared type is exactly the expected one apart from null and undefined,
 * and apart from text: a shape of text takes a property declaring narrower text, as `@Property.string()` does.
 *
 * Exact rather than assignable: a property declaring fewer shapes than its decorator would compile
 * against an assignability check and hold values it has no name for.
 */
type MatchingKey<Target, Key extends keyof Target, Expected> = [NonNullable<Target[Key]>] extends [Expected]
    ? [Expected] extends [WidenedShapeValues<NonNullable<Target[Key]>>] ? Key : never
    : never;

/**
 * A declared value of several named shapes, with narrower text in each value widened to text.
 */
type WidenedShapeValues<T> = T extends NamedShapeValue
    ? OneOf<{ [Shape in T['shape']]: WidenedText<T['value']> }>
    : T;

/**
 * Narrower text widened to text, in the value itself or in the items of a list.
 */
type WidenedText<T> = T extends string
    ? string
    : T extends (infer Item)[]
        ? WidenedText<Item>[]
        : T;

/**
 * Creates full metadata for a property that holds one of several named shapes.
 * @param data - The shapes by name, and what the property as a whole is declared with.
 * @param fullPropertyKey - The full key of the property, for messages.
 * @returns The full metadata.
 * @throws When the shapes cannot be told apart or cannot be carried as json.
 */
export function createOneOfPropertyMetadata(
    data: OneOfPropertyMetadataInput<OneOfShapesMetadataInput<AnyStrategyStringPropertyMetadataInput>>,
    fullPropertyKey: string
): OneOfPropertyMetadata {
    const entries: [string, OneOfShapeMetadataInput<AnyStrategyStringPropertyMetadataInput>][]
        = ObjectUtilities.entries(data.shapes);
    if (entries.length < 2) {
        throw new InternalError([
            `${fullPropertyKey}: A property that holds one of several shapes needs at least two shapes.`,
            'Declare it as the one shape it has instead.'
        ]);
    }
    const filterKeys: Map<string, string> = new Map();
    const shapes: Record<string, OneOfShapeMetadata> = {};
    for (const [name, shape] of entries) {
        if (!name) {
            throw new InternalError(`${fullPropertyKey}: A shape cannot have an empty name.`);
        }
        const filterKey: string = OneOfWhereFilterUtilities.filterKey(name);
        const sameFilterKey: string | undefined = filterKeys.get(filterKey);
        if (sameFilterKey != undefined) {
            throw new InternalError([
                `${fullPropertyKey}: The shapes "${sameFilterKey}" and "${name}" are both filtered as "${filterKey}".`,
                'Name them so that they differ by more than the case of their first letter.'
            ]);
        }
        filterKeys.set(filterKey, name);
        shapes[name] = createShapeMetadata(shape, `${fullPropertyKey}.${name}`);
    }
    return {
        required: true,
        description: undefined,
        exclude: false,
        excludeFromChangeSets: ObjectUtilities.values(shapes).some(holdsGeneratedStrings)
            || (typeof data.exclude === 'boolean' ? data.exclude : false),
        ...data,
        type: 'oneOf',
        shapes
    };
}

/**
 * Creates full metadata for a value that is the first of several shapes it fits.
 * @param shapes - The shapes, in the order they are tried.
 * @param fullKey - Where the value is declared, for messages.
 * @returns The full metadata.
 * @throws When fewer than two shapes are listed, or a shape cannot be one.
 */
export function createAnyOfShapesMetadata(
    shapes: OneOfShapeMetadataInput<IncomingStringPropertyMetadataInput>[],
    fullKey: string
): AnyOfShapesMetadata {
    if (shapes.length < 2) {
        throw new InternalError([
            `${fullKey}: A value of one of several shapes needs at least two shapes.`,
            'Declare it as the one shape it has instead.'
        ]);
    }
    return { type: 'anyOf', shapes: shapes.map((shape, i) => createShapeMetadata(shape, `${fullKey}.${i}`)) };
}

/**
 * Creates full metadata for one shape of several.
 * @param shape - The shape as declared.
 * @param fullKey - Where the shape is declared, for messages.
 * @returns The full metadata.
 * @throws When the shape is a file or itself one of several shapes.
 */
function createShapeMetadata(shape: OneOfShapeMetadataInput<AnyStrategyStringPropertyMetadataInput>, fullKey: string): OneOfShapeMetadata {
    // checked on the input's type rather than trusted to it, for a caller without types
    const kind: string = shape.type;
    if (kind === 'oneOf') {
        throw new InternalError([
            `${fullKey}: One of several shapes cannot be one of the shapes.`,
            'Write its shapes into this list in its place.'
        ]);
    }
    if (kind === 'file') {
        throw new InternalError([
            `${fullKey}: A file cannot be one of several shapes, because a value of several shapes is carried as json.`,
            'Declare the file as a property of its own.'
        ]);
    }
    const created: ArrayPropertyItemMetadata = createArrayItemPropertyMetadata(shape, fullKey);
    if (created.type === 'oneOf' || created.type === 'file') {
        throw new InternalError(`${fullKey}: Unexpected shape "${created.type}".`);
    }
    // a shape either is the value or is not, so whether the property may be left out is a question
    // for the property as a whole
    return { ...created, required: true };
}