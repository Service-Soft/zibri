import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model';
import { OneOfShapeMetadata } from '../entity/models/one-of-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * What a property of a model, an item of an array or a shape of a oneOf declares about a value.
 */
type DeclaredValueMetadata = PropertyMetadata | ArrayPropertyItemMetadata | OneOfShapeMetadata;

/**
 * Writes a JSON response with what its declaration names, and nothing else.
 */
export abstract class DeclaredResponseUtilities {
    /**
     * The value a response declaring the given classes is written with: the properties the classes
     * declare, all the way down, and none of the others. A nested object that allows additional
     * properties keeps them; a property of unknown type keeps whatever it holds.
     * @param value - What the handler returned, or one item of it.
     * @param classes - The classes the response declares for the value. Several are one of them, so
     * the value keeps what any of them declares.
     * @returns The value, without what the classes do not declare.
     */
    static resolveDeclaredValue(value: unknown, classes: Newable<unknown>[]): unknown {
        if (!DeclaredResponseUtilities.isRecord(value)) {
            return value;
        }
        return DeclaredResponseUtilities.resolveModelValue(value, DeclaredResponseUtilities.resolveProperties(classes), false);
    }

    private static resolveModelValue(
        value: Record<string, unknown>,
        properties: Record<string, PropertyMetadata>,
        keepsUndeclared: boolean
    ): Record<string, unknown> {
        // a class that declares no property, such as one with an index signature, describes no shape
        // to keep to: it says the value is an object, whatever it holds
        if (ObjectUtilities.keys(properties).length === 0) {
            return value;
        }
        const res: Record<string, unknown> = keepsUndeclared ? { ...value } : {};
        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            // `in` rather than own keys, so a value that is an instance answers its getters too
            if (key in value) {
                res[key] = DeclaredResponseUtilities.resolvePropertyValue(value[key], metadata);
            }
        }
        return res;
    }

    private static resolvePropertyValue(value: unknown, metadata: DeclaredValueMetadata): unknown {
        switch (metadata.type) {
            case 'object': {
                return DeclaredResponseUtilities.isRecord(value)
                    ? DeclaredResponseUtilities.resolveModelValue(
                        value,
                        MetadataUtilities.getModelProperties(metadata.cls()),
                        metadata.allowAdditionalProperties
                    )
                    : value;
            }
            case 'array': {
                return Array.isArray(value)
                    ? value.map(item => DeclaredResponseUtilities.resolvePropertyValue(item, metadata.items))
                    : value;
            }
            case 'oneOf': {
                return DeclaredResponseUtilities.resolveOneOfValue(value, metadata.shapes);
            }
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return Array.isArray(value)
                    ? value.map(item => DeclaredResponseUtilities.resolveDeclaredValue(item, [metadata.target()]))
                    : DeclaredResponseUtilities.resolveDeclaredValue(value, [metadata.target()]);
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'unknown': {
                return value;
            }
        }
    }

    // a value of several shapes names the one it is, `{ shape, value }`, so its value keeps what that
    // shape declares. A shape the property does not declare leaves nothing to keep to but the name
    private static resolveOneOfValue(value: unknown, shapes: Record<string, OneOfShapeMetadata>): unknown {
        if (!DeclaredResponseUtilities.isRecord(value) || typeof value['shape'] !== 'string') {
            return value;
        }
        const shape: OneOfShapeMetadata | undefined = shapes[value['shape']];
        return shape == undefined
            ? { shape: value['shape'] }
            : { shape: value['shape'], value: DeclaredResponseUtilities.resolvePropertyValue(value['value'], shape) };
    }

    private static resolveProperties(classes: Newable<unknown>[]): Record<string, PropertyMetadata> {
        const res: Record<string, PropertyMetadata> = {};
        for (const cls of classes) {
            for (const [key, metadata] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(cls))) {
                res[key] ??= metadata;
            }
        }
        return res;
    }

    // a date, a bignumber and a buffer are values json writes whole, not objects to walk
    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object'
            && value !== null
            && !Array.isArray(value)
            && !(value instanceof Date)
            && !ArrayBuffer.isView(value)
            && !('toJSON' in value);
    }
}