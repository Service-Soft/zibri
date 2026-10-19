import { BodyMetadata, BodyMetadataInput, BodyShapeMetadata, OneOfBodyMetadataInput, RawXmlBodyMetadataInput, ShapedBodyMetadata, StreamBodyMetadataInput } from './body-metadata.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
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
 * Defines an xml http request body handed over as the document that arrived, a string, such as one
 * whose signature has to be checked.
 * @param options - `type: MimeType.XML` and `raw: true`, and additional options like the size.
 */
export function Body(options: RawXmlBodyMetadataInput): ParameterDecorator;
/**
 * Defines a http request body property with the given data.
 * @param modelClass - The model class that defines the body properties structure, or a function answering
 * it for a class that is only known once the application has started.
 * @param options - Additional options, like the type.
 */
export function Body(
    modelClass: Newable<unknown> | (() => Newable<unknown>),
    options?: ExcludeStrict<BodyMetadataInput, StreamBodyMetadataInput>
): ParameterDecorator;
export function Body(
    modelClassOrOptions: Newable<unknown> | (() => Newable<unknown>) | RawXmlBodyMetadataInput,
    options: ExcludeStrict<BodyMetadataInput, StreamBodyMetadataInput> = {}
): ParameterDecorator {
    return (target, propertyKey, index) => {
        const metadata: BodyMetadata = typeof modelClassOrOptions === 'function'
            ? resolveBodyMetadata({ ...options, modelClass: modelClassOrOptions }, index)
            : resolveBodyMetadata(modelClassOrOptions, index);
        setRouteBody(target, propertyKey, metadata);
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
     * Defines a http request body that is a stream.
     * @param data - Options like the maximum size etc.
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
    MetadataUtilities.setFilePath(ctor);
    const key: string = propertyKey?.toString() ?? '';
    MetadataUtilities.setRouteBody(ctor, metadata, key);
}

/**
 * What the files of each body shape add to its size, once worked out.
 */
const fileAllowances: WeakMap<BodyShapeMetadata, BigNumber> = new WeakMap();

/**
 * The most a body may weigh: its base maximum size, and the sizes of the files it may carry.
 *
 * Worked out when a body is first read rather than when it is declared, so a shape may name a class
 * that only exists once the application has started.
 * @param metadata - The body.
 * @returns The size in bytes.
 */
export function resolveMaxBodySize(metadata: Pick<ShapedBodyMetadata, 'shape' | 'baseMaxSize'>): BigNumber {
    let allowance: BigNumber | undefined = fileAllowances.get(metadata.shape);
    if (allowance == undefined) {
        allowance = metadata.shape.type === 'anyOf'
            ? largestOf(metadata.shape.shapes)
            : resolveMaxSize(NumberUtilities.new(0), { body: metadata.shape });
        fileAllowances.set(metadata.shape, allowance);
    }
    return metadata.baseMaxSize.plus(allowance);
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