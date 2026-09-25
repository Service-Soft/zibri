import { BodyMetadata, BodyMetadataInput, BodyShapeMetadata, OneOfBodyMetadataInput, StreamBodyMetadataInput } from './body-metadata.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { FileSize, fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { MimeType } from '../../http/mime-type.enum';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { resolveBodyMetadata } from '../resolve-body-metadata.function';

/**
 * Defines a http request body property with the given data.
 * @param modelClass - The model class that defines the body properties structure.
 * @param options - Additional options, like the type.
 */
export function Body(
    modelClass: Newable<unknown>,
    options: ExcludeStrict<BodyMetadataInput, StreamBodyMetadataInput> = {}
): ParameterDecorator {
    return (target, propertyKey, index) => {
        setRouteBody(target, propertyKey, resolveBodyMetadata({ ...options, modelClass }, index));
    };
}

/**
 * Bundles the other ways of defining a http request body.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Body {
    /**
     * Defines a http request body property that is one of several shapes.
     * @param data - The shapes, and additional options like the type.
     */
    export function oneOf(data: OneOfBodyMetadataInput): ParameterDecorator {
        // resolved before the decorator is applied, so that a declaration that cannot work is refused
        // where it is written
        const withoutIndex: BodyMetadata = resolveBodyMetadata(data, 0);
        return (target, propertyKey, index) => {
            setRouteBody(target, propertyKey, { ...withoutIndex, index });
        };
    }

    /**
     *
     * @param data
     */
    export function stream(data: OmitStrict<StreamBodyMetadataInput, 'type'>): ParameterDecorator {
        const withoutIndex: BodyMetadata = resolveBodyMetadata({ ...data, type: MimeType.OCTET_STREAM }, 0);
        return (target, propertyKey, index) => {
            setRouteBody(target, propertyKey, { ...withoutIndex, index });
        };
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function setRouteBody(target: Object, propertyKey: string | symbol | undefined, metadata: BodyMetadata): void {
    const ctor: Function = target.constructor;
    // eslint-disable-next-line unicorn/error-message
    const stack: string = new Error().stack ?? '';
    MetadataUtilities.setFilePath(ctor, stack);
    const key: string = propertyKey?.toString() ?? '';
    MetadataUtilities.setRouteBody(ctor, metadata, key);
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function resolveMaxBodySize(shape: BodyShapeMetadata, baseMaxSize: FileSize = '100kb'): BigNumber {
    if (shape.type === 'anyOf') {
        return fileSizeToBytes(baseMaxSize).plus(largestOf(shape.shapes));
    }
    return resolveMaxSize(fileSizeToBytes(baseMaxSize), { body: shape });
}

/**
 * What the largest of several shapes adds to a body, since a value is only ever one of them.
 * @param shapes - The shapes.
 * @returns The most any one of them adds.
 */
function largestOf(shapes: PropertyMetadata[]): BigNumber {
    return BigNumber.max(...shapes.map(shape => resolveMaxSize(NumberUtilities.new(0), { shape })));
}

// eslint-disable-next-line jsdoc/require-jsdoc
function resolveMaxSize(bytes: BigNumber, properties: Record<string, PropertyMetadata>): BigNumber {
    for (const property of ObjectUtilities.values(properties)) {
        switch (property.type) {
            case 'file': {
                bytes = bytes.plus(fileSizeToBytes(property.maxSize));
                break;
            }
            case 'array': {
                if (property.items.type === 'file') {
                    bytes = bytes.plus(fileSizeToBytes(property.totalMaxSize));
                }
                break;
            }
            case 'object': {
                // what the class adds, counted from nothing - counted from `bytes` it added the
                // size so far to itself once for every class the body names
                const objectProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(property.cls());
                bytes = bytes.plus(resolveMaxSize(NumberUtilities.new(0), objectProperties));
                break;
            }
            case 'oneOf': {
                bytes = bytes.plus(largestOf(ObjectUtilities.values(property.shapes)));
                break;
            }
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY:
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'unknown': {
                break;
            }
        }
    }
    return bytes;
}