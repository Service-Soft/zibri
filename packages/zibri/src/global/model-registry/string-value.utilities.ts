import { DescribedString, StringValueDescriptor } from './string-value-descriptor.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { StoredStringPropertyMetadata } from '../../entity/models/string-property-metadata.model';
import { isNamedValue } from '../../parsing/functions/parse-one-of.function';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * Finds and replaces the strings a property acts on - encrypts, decrypts, hashes - wherever its
 * declaration puts them: the value itself, each item of an array, the value of a named shape.
 */
export abstract class StringValueUtilities {
    /**
     * Resolves where the strings with settings sit in values of the given property.
     * @param metadata - The property, or the items or a shape of one.
     * @param settingsOf - The settings a string declares, or undefined when it declares none.
     * @returns The descriptor, or undefined when no string in the value has settings.
     */
    static resolveDescriptor<TSettings>(
        metadata: PropertyMetadata | ArrayPropertyItemMetadata,
        settingsOf: (metadata: StoredStringPropertyMetadata) => TSettings | undefined
    ): StringValueDescriptor<TSettings> | undefined {
        switch (metadata.type) {
            case 'string': {
                const settings: TSettings | undefined = settingsOf(metadata);
                return settings == undefined ? undefined : { kind: 'string', settings };
            }
            case 'array': {
                const items: StringValueDescriptor<TSettings> | undefined = this.resolveDescriptor(metadata.items, settingsOf);
                return items == undefined ? undefined : { kind: 'items', items };
            }
            case 'oneOf': {
                const shapes: Map<string, StringValueDescriptor<TSettings>> = new Map();
                for (const [name, shape] of ObjectUtilities.entries(metadata.shapes)) {
                    const described: StringValueDescriptor<TSettings> | undefined = this.resolveDescriptor(shape, settingsOf);
                    if (described != undefined) {
                        shapes.set(name, described);
                    }
                }
                return shapes.size ? { kind: 'shapes', shapes } : undefined;
            }
            case Relation.MANY_TO_ONE:
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.MANY_TO_MANY:
            case Relation.ONE_TO_MANY:
            case 'object': {
                // these hold models, whose own strings the descriptor of their class keeps
                return undefined;
            }
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'unknown': {
                return undefined;
            }
        }
    }

    /**
     * Finds every string the descriptor reaches in a value.
     * @param value - The value of the property.
     * @param descriptor - Where its strings sit.
     * @returns Each string with its settings, in the order the value holds them.
     */
    static findStrings<TSettings>(value: unknown, descriptor: StringValueDescriptor<TSettings>): DescribedString<TSettings>[] {
        switch (descriptor.kind) {
            case 'string': {
                return typeof value === 'string' ? [{ value, settings: descriptor.settings }] : [];
            }
            case 'items': {
                return Array.isArray(value) ? value.flatMap(item => this.findStrings(item, descriptor.items)) : [];
            }
            case 'shapes': {
                const shape: StringValueDescriptor<TSettings> | undefined = isNamedValue(value)
                    ? descriptor.shapes.get(value.shape)
                    : undefined;
                return isNamedValue(value) && shape != undefined ? this.findStrings(value.value, shape) : [];
            }
        }
    }

    /**
     * Replaces every string the descriptor reaches in a value.
     *
     * Builds a new array or named value around what it replaces rather than changing the one it was
     * given, which may be the caller's own.
     * @param value - The value of the property.
     * @param descriptor - Where its strings sit.
     * @param replace - What a string becomes, given its settings. Called one string at a time.
     * @returns The value with each string replaced, or the value itself when it holds none.
     */
    static async replaceStrings<TSettings>(
        value: unknown,
        descriptor: StringValueDescriptor<TSettings>,
        replace: (value: string, settings: TSettings) => Promise<string>
    ): Promise<unknown> {
        switch (descriptor.kind) {
            case 'string': {
                return typeof value === 'string' ? await replace(value, descriptor.settings) : value;
            }
            case 'items': {
                if (!Array.isArray(value)) {
                    return value;
                }
                // one at a time, so a strategy creating its first key does it once rather than once per item
                const res: unknown[] = [];
                for (const item of value) {
                    res.push(await this.replaceStrings(item, descriptor.items, replace));
                }
                return res;
            }
            case 'shapes': {
                if (!isNamedValue(value)) {
                    return value;
                }
                const shape: StringValueDescriptor<TSettings> | undefined = descriptor.shapes.get(value.shape);
                return shape == undefined ? value : { ...value, value: await this.replaceStrings(value.value, shape, replace) };
            }
        }
    }
}