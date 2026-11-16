import { OpenApiResponse, OpenApiResponsesObject, OpenApiResponseObject, OpenApiContentObject, OpenApiSchemaObject, OpenApiSchemaObjectType, OpenApiRequestBodyObject, OpenApiParameterLocation, OpenApiParameter, OpenApiReferenceObject, isOpenApiReferenceObject, JsonOpenApiResponse, OpenApiXmlObject } from './open-api.model';
import { resolveResponseClass } from './resolve-response-class.function';
import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model';
import { BelongsToOnePropertyMetadata } from '../entity/models/belongs-to-one-property-metadata.model';
import { BooleanPropertyMetadata } from '../entity/models/boolean-property-metadata.model';
import { HasOnePropertyMetadata } from '../entity/models/has-one-property-metadata.model';
import { ManyToManyPropertyMetadata } from '../entity/models/many-to-many-property-metadata.model';
import { ManyToOnePropertyMetadata } from '../entity/models/many-to-one-property-metadata.model';
import { NumberFormat, NumberPropertyMetadata } from '../entity/models/number-property-metadata.model';
import { AnyOfShapesMetadata, OneOfShapeMetadata } from '../entity/models/one-of-property-metadata.model';
import { OneToManyPropertyMetadata } from '../entity/models/one-to-many-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { StringPropertyMetadata } from '../entity/models/string-property-metadata.model';
import { OmitClass } from '../entity/omit-class.model';
import { isRequiredWhenGiven } from '../entity/required-when-given.function';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { XmlModelUtilities } from '../parsing/xml/xml-model.utilities';
import { XmlPropertyMetadata } from '../parsing/xml/xml-property-metadata.model';
import { XmlRootMetadata } from '../parsing/xml/xml-root-metadata.model';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { ArrayParamItemMetadata } from '../routing/models/array-param-metadata.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

const defaultDescriptionForHttpStatus: Record<HttpStatus | 'default', string> = {
    default: 'Response',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
    [HttpStatus.NOT_FOUND]: 'Not Found',
    [HttpStatus.BAD_REQUEST]: 'Bad Request',
    [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
    [HttpStatus.FORBIDDEN]: 'Forbidden',
    [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
    [HttpStatus.OK]: 'Ok',
    [HttpStatus.CREATED]: 'Created',
    [HttpStatus.CONTINUE]: 'Continue',
    [HttpStatus.SWITCHING_PROTOCOLS]: '',
    [HttpStatus.PROCESSING]: '',
    [HttpStatus.ACCEPTED]: '',
    [HttpStatus.NON_AUTHORITATIVE_INFORMATION]: '',
    [HttpStatus.NO_CONTENT]: '',
    [HttpStatus.RESET_CONTENT]: '',
    [HttpStatus.PARTIAL_CONTENT]: '',
    [HttpStatus.MULTIPLE_CHOICES]: '',
    [HttpStatus.MOVED_PERMANENTLY]: '',
    [HttpStatus.FOUND]: '',
    [HttpStatus.SEE_OTHER]: '',
    [HttpStatus.NOT_MODIFIED]: '',
    [HttpStatus.TEMPORARY_REDIRECT]: '',
    [HttpStatus.PERMANENT_REDIRECT]: '',
    [HttpStatus.PAYMENT_REQUIRED]: '',
    [HttpStatus.METHOD_NOT_ALLOWED]: '',
    [HttpStatus.NOT_ACCEPTABLE]: '',
    [HttpStatus.REQUEST_TIMEOUT]: '',
    [HttpStatus.CONFLICT]: '',
    [HttpStatus.GONE]: '',
    [HttpStatus.PRECONDITION_FAILED]: '',
    [HttpStatus.CONTENT_TOO_LARGE]: '',
    [HttpStatus.URI_TOO_LONG]: '',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: '',
    [HttpStatus.UNPROCESSABLE_ENTITY]: '',
    [HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE]: '',
    [HttpStatus.NOT_IMPLEMENTED]: '',
    [HttpStatus.BAD_GATEWAY]: '',
    [HttpStatus.SERVICE_UNAVAILABLE]: '',
    [HttpStatus.GATEWAY_TIMEOUT]: '',
    [HttpStatus.HTTP_VERSION_NOT_SUPPORTED]: ''
};

/**
 * How one kind of number is described in an open api document.
 */
type OpenApiNumberType = {
    /**
     * The json type a value of it arrives and leaves as.
     */
    type: 'number' | 'integer' | 'string',
    /**
     * What that json type is carrying, in open api's own vocabulary.
     */
    format: string
};

/**
 * What a string schema is built from, shared by string properties and string parameters.
 */
type StringSchemaSource = Pick<
    StringPropertyMetadata<unknown, unknown, never, never, never>,
    'format' | 'description' | 'minLength' | 'maxLength' | 'regex' | 'enum'
>;

/**
 * What a number schema is built from, shared by number properties and number parameters.
 */
type NumberSchemaSource = Pick<NumberPropertyMetadata, 'format' | 'description' | 'min' | 'max' | 'enum'>;

/**
 * What a boolean schema is built from, shared by boolean properties and boolean parameters.
 */
type BooleanSchemaSource = Pick<BooleanPropertyMetadata, 'description'>;

/**
 * Describes what a route takes and answers with in the terms of an open api document.
 */
export abstract class OpenApiSchemaUtilities {
    /**
     * Describes the responses a route declares.
     * @param responses - What the route declares it can answer with.
     * @returns The responses of its operation, by status.
     */
    static resolveResponses(responses: OpenApiResponse[]): OpenApiResponsesObject | undefined {
        const res: OpenApiResponsesObject = {};

        const groupedResponses: Record<string, OpenApiResponse[]> = {};
        for (const response of responses) {
            const status: string = `${response.status ?? 'default'}`;
            const group: OpenApiResponse[] = groupedResponses[status] ?? [];
            group.push(response);
            groupedResponses[status] = group;
        }

        for (const [status, r] of ObjectUtilities.entries(groupedResponses)) {
            const response: OpenApiResponse | undefined = r.length === 1 ? r[0] : undefined;
            if (response == undefined) {
                const data: OpenApiResponseObject = {
                    description: '',
                    content: this.buildResponsesContent(r)
                };
                res[status] = data;
            }
            else {
                const data: OpenApiResponseObject = {
                    description: response.description ?? defaultDescriptionForHttpStatus[response.status ?? 'default'],
                    content: this.buildResponseContent(response),
                    // where a redirect sends the caller is all it says
                    ...response.type === 'redirect'
                        ? { headers: { [KnownHeader.LOCATION]: { schema: { type: 'string', format: 'uri' } } } }
                        : {}
                };
                res[status] = data;
            }
        }

        return res;
    }

    /**
     * Describes the body a route takes.
     * @param metadata - What the route declared its body as, if it takes one.
     * @returns The request body of its operation, or undefined when it takes none.
     */
    static resolveRequestBody(metadata: BodyMetadata | undefined): OpenApiRequestBodyObject | undefined {
        if (!metadata) {
            return undefined;
        }

        const schema: OpenApiSchemaObject | OpenApiReferenceObject = metadata.type === MimeType.OCTET_STREAM
            ? {
                type: 'string',
                format: 'binary'
            }
            : this.buildShapeSchema(metadata.shape, 'request');
        // an xml body of one model is that model's document, whose root element it names
        const rooted: OpenApiSchemaObject | OpenApiReferenceObject = metadata.type === MimeType.XML
            && metadata.shape.type === 'object'
            && !isOpenApiReferenceObject(schema)
            ? this.withXmlRoot(schema, metadata.shape.cls())
            : schema;
        return {
            required: typeof metadata.required === 'boolean' ? metadata.required : undefined,
            description: metadata.description,
            content: { [metadata.type]: { schema: rooted } }
        };
    }

    /**
     * Describes the parameters a route takes from one part of the request.
     * @param params - What the route declared them as.
     * @param location - Where in the request they are.
     * @returns The parameters of its operation.
     */
    static resolveParameters(
        params: Record<number, QueryParamMetadata | HeaderParamMetadata | PathParamMetadata>,
        location: OpenApiParameterLocation
    ): OpenApiParameter[] {
        return ObjectUtilities.values(params).map(meta => ({
            name: meta.name,
            in: location,
            required: typeof meta.required === 'boolean' ? meta.required : undefined,
            // said rather than left to the default it is, since it is what the router reads: one
            // value per item, and a value alone a list of one
            style: location === 'query' && meta.type === 'array' ? 'form' : undefined,
            explode: location === 'query' && meta.type === 'array' ? true : undefined,
            content: meta.type === 'object'
                ? {
                    [MimeType.JSON]: {
                        schema: this.paramToSchema(meta)
                    }
                }
                : undefined,
            schema: meta.type === 'object' ? undefined : this.paramToSchema(meta),
            description: meta.description
        }));
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static buildResponseContent(response: OpenApiResponse): OpenApiContentObject | undefined {
        switch (response.type) {
            case 'file': {
                const schema: OpenApiSchemaObject = { type: 'string', format: 'binary' };
                // normalize mimeType into an array; default to octet‑stream
                const mimeTypes: MimeType[] = Array.isArray(response.mimeType)
                    ? response.mimeType
                    : response.mimeType != undefined
                        ? [response.mimeType === 'all' ? MimeType.OCTET_STREAM : response.mimeType]
                        : [MimeType.OCTET_STREAM];

                const content: OpenApiContentObject = {};
                for (const mt of mimeTypes) {
                    content[mt] = { schema };
                }
                return content;
            }
            case 'json': {
                const cls: Newable<unknown> | undefined = resolveResponseClass(response);
                if (!cls) {
                    return undefined;
                }
                const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
                const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, cls, 'response', new Set());

                if (response.isArray === true) {
                    return { [MimeType.JSON]: { schema: { type: 'array', items: schema } } };
                }

                const content: OpenApiContentObject = {};
                for (const mimeType of response.mimeTypes ?? [MimeType.JSON]) {
                    content[mimeType] = { schema: mimeType === MimeType.XML ? this.withXmlRoot(schema, cls) : schema };
                }
                return content;
            }
            case 'html': {
                const schema: OpenApiSchemaObject = {
                    type: 'string',
                    format: 'html'
                };
                return { [MimeType.HTML]: { schema } };
            }
            case 'empty':
            case 'redirect':
            case 'error': {
                return undefined;
            }
            default: {
                throw new InternalError(`Unknown response type ${(response as OpenApiResponse).type}`);
            }
        }

    }

    private static buildResponsesContent(responses: OpenApiResponse[]): OpenApiContentObject | undefined {
        const schemas: OpenApiSchemaObject[] = [];
        const xmlSchemas: OpenApiSchemaObject[] = [];
        for (const response of responses) {
            switch (response.type) {
                case 'file': {
                    schemas.push({ type: 'string', format: 'binary' });
                    continue;
                }
                case 'html': {
                    schemas.push({ type: 'string', format: 'html' });
                    continue;
                }
                case 'json': {
                    this.addModelSchemas(response, schemas, xmlSchemas);
                    continue;
                }
                case 'empty':
                case 'redirect':
                case 'error': {
                    continue;
                }
                default: {
                    throw new InternalError(`Unknown response type ${(response as OpenApiResponse).type}`);
                }
            }

        }

        if (!xmlSchemas.length) {
            return { [MimeType.JSON]: { schema: { oneOf: schemas } } };
        }
        return {
            ...schemas.length ? { [MimeType.JSON]: { schema: { oneOf: schemas } } } : {},
            [MimeType.XML]: { schema: { oneOf: xmlSchemas } }
        };
    }

    /**
     * Adds the schema of a model response to the formats it can be written in.
     * @param response - The declared response.
     * @param schemas - The schemas of the json content, added to.
     * @param xmlSchemas - The schemas of the xml content, added to.
     */
    private static addModelSchemas(response: JsonOpenApiResponse, schemas: OpenApiSchemaObject[], xmlSchemas: OpenApiSchemaObject[]): void {
        const cls: Newable<unknown> | undefined = resolveResponseClass(response);
        if (!cls) {
            return;
        }
        const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const schema: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(propMeta, cls, 'response', new Set());
        if (response.isArray === true) {
            schemas.push({ type: 'array', items: schema });
            return;
        }
        const mimeTypes: MimeType[] = response.mimeTypes ?? [MimeType.JSON];
        if (mimeTypes.includes(MimeType.JSON)) {
            schemas.push(schema);
        }
        if (mimeTypes.includes(MimeType.XML)) {
            xmlSchemas.push(this.withXmlRoot(schema, cls));
        }
    }

    /**
     * The schema of a model as the root element of an xml document: named, and in the namespace, that `@XmlRoot` gives it.
     * @param schema - The schema of the model.
     * @param cls - The model.
     * @returns The schema, naming its element.
     */
    private static withXmlRoot(schema: OpenApiSchemaObject, cls: Newable<unknown>): OpenApiSchemaObject {
        const root: XmlRootMetadata | undefined = MetadataUtilities.findXmlRoot(cls);
        const prefix: string | undefined = this.findXmlPrefix(root, root?.namespace);
        return {
            ...this.qualifyXmlElements(schema, cls, root),
            xml: { name: root?.name ?? cls.name, namespace: root?.namespace, ...prefix == undefined ? {} : { prefix } }
        };
    }

    /**
     * Copies the schema of a model inside an xml document, naming the namespace of each child element that is not
     * in the document's default one.
     *
     * Which namespace an element is in depends on the document, not only on its model: a model without a namespace
     * of its own takes the document's. So this is done per document, on a copy, leaving the schema json uses as it
     * is.
     * @param schema - The schema of the model.
     * @param cls - The model.
     * @param root - The root of the document.
     * @returns The schema, its child elements qualified.
     */
    private static qualifyXmlElements(
        schema: OpenApiSchemaObject,
        cls: Newable<unknown>,
        root: XmlRootMetadata | undefined
    ): OpenApiSchemaObject {
        if (schema.properties == undefined) {
            return schema;
        }
        // the root's namespace is written without a prefix unless it has one, as the writer does. An element
        // in the default namespace needs nothing, since it inherits the declaration on the root
        const defaultNamespace: string | undefined = this.findXmlPrefix(root, root?.namespace) == undefined ? root?.namespace : undefined;
        const namespace: string | undefined = XmlModelUtilities.resolveNamespace(cls, root?.namespace);
        const prefix: string | undefined = this.findXmlPrefix(root, namespace);
        const qualified: OpenApiXmlObject = namespace === defaultNamespace
            ? {}
            : { namespace, ...prefix == undefined ? {} : { prefix } };

        const models: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const properties: Record<string, OpenApiSchemaObject | OpenApiReferenceObject> = {};
        for (const [key, property] of ObjectUtilities.entries(schema.properties)) {
            const metadata: PropertyMetadata | undefined = models[key];
            // attributes are written without a namespace, and mixed content has no form in this version of
            // OpenAPI at all, so its elements are not described either
            properties[key] = isOpenApiReferenceObject(property)
                || metadata == undefined
                || XmlModelUtilities.getXmlProperty(cls, key).kind !== 'element'
                ? property
                : this.qualifyXmlElement(property, metadata, qualified, root);
        }
        return { ...schema, properties };
    }

    /**
     * Qualifies the element of one property, and the elements of the model it holds.
     * @param property - The schema of the property.
     * @param metadata - The property.
     * @param qualified - The namespace of the element.
     * @param root - The root of the document.
     * @returns The schema, qualified.
     */
    private static qualifyXmlElement(
        property: OpenApiSchemaObject,
        metadata: PropertyMetadata,
        qualified: OpenApiXmlObject,
        root: XmlRootMetadata | undefined
    ): OpenApiSchemaObject {
        switch (metadata.type) {
            case 'object': {
                return { ...this.qualifyXmlElements(property, metadata.cls(), root), xml: { ...property.xml, ...qualified } };
            }
            case 'array': {
                // a list is its element repeated rather than wrapped, so the element is its items
                if (property.items == undefined || isOpenApiReferenceObject(property.items)) {
                    return property;
                }
                const items: OpenApiSchemaObject = metadata.items.type === 'object'
                    ? this.qualifyXmlElements(property.items, metadata.items.cls(), root)
                    : property.items;
                return { ...property, items: { ...items, xml: { ...property.items.xml, ...qualified } } };
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'oneOf':
            case 'unknown':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return { ...property, xml: { ...property.xml, ...qualified } };
            }
        }
    }

    private static findXmlPrefix(root: XmlRootMetadata | undefined, namespace: string | undefined): string | undefined {
        return ObjectUtilities.entries(root?.prefixes ?? {}).find(([, prefixed]) => prefixed === namespace)?.[0];
    }

    /**
     * Says how the properties of a model appear in xml, where that is not as a child element of their own name.
     *
     * On the schema json uses too, which is safe: json ignores it. The element's own text and mixed content have no
     * form in this version of OpenAPI, so a property read from either is described like a child element. Which
     * namespace an element is in is the document's to say, see `qualifyXmlElements`.
     * @param properties - The schemas of the model's properties, by property.
     * @param cls - The model.
     */
    private static annotateXml(properties: Record<string, OpenApiSchemaObject>, cls: Newable<unknown>): void {
        for (const [key, property] of ObjectUtilities.entries(properties)) {
            const xml: XmlPropertyMetadata = XmlModelUtilities.getXmlProperty(cls, key);
            switch (xml.kind) {
                case 'attribute': {
                    properties[key] = { ...property, xml: { name: xml.name, attribute: true } };
                    break;
                }
                case 'element': {
                    // a property without a decorator is its element already
                    if (!Object.hasOwn(MetadataUtilities.getXmlProperties(cls), key)) {
                        break;
                    }
                    const element: OpenApiXmlObject = { name: xml.name };
                    // a list is its element repeated rather than wrapped, so the name belongs to its items
                    properties[key] = property.items != undefined && !isOpenApiReferenceObject(property.items)
                        ? { ...property, items: { ...property.items, xml: element } }
                        : { ...property, xml: element };
                    break;
                }
                case 'text':
                case 'mixed': {
                    break;
                }
            }
        }
    }

    /**
     * The schema of a value of one shape, on its own rather than as a property of a model.
     * @param shape - The shape.
     * @param context - Whether the value is sent or answered with.
     * @returns Its schema.
     */
    private static buildShapeSchema(
        shape: ArrayPropertyItemMetadata | AnyOfShapesMetadata,
        context: 'request' | 'response'
    ): OpenApiSchemaObject | OpenApiReferenceObject {
        if (shape.type === 'anyOf') {
            return this.buildAnyOfSchema(shape.shapes, undefined, context);
        }
        return this.buildOpenApiSchemaForProperties({ shape }, class {}, context, new Set()).properties?.['shape'] ?? {};
    }

    /**
     * The schema of a value that is the first of several shapes it fits.
     *
     * AnyOf rather than oneOf: oneOf says exactly one shape matches, and a value is read as the first
     * shape it fits even where a later one would match too - a date is also text.
     * @param shapes - The shapes, in order.
     * @param description - What the value is.
     * @param context - Whether the value is sent or answered with.
     * @returns Its schema.
     */
    private static buildAnyOfSchema(
        shapes: OneOfShapeMetadata[],
        description: string | undefined,
        context: 'request' | 'response'
    ): OpenApiSchemaObject {
        return { description, anyOf: shapes.map(shape => this.buildShapeSchema(shape, context)) };
    }

    private static buildOpenApiSchemaForProperties(
        propMeta: Record<string, PropertyMetadata>,
        entity: Newable<unknown>,
        context: 'request' | 'response',
        visited: Set<Newable<unknown>>
    ): OpenApiSchemaObject {
        // ---- cycle guard ----
        if (visited.has(entity)) {
        // Return a stub schema (or a ref if you later extract components).
        // Returning an empty object is safe, but a description helps debugging.
            return { type: 'object', description: 'Circular reference omitted' };
        }
        visited.add(entity);

        const properties: Record<string, OpenApiSchemaObject> = {};
        const required: string[] = [];

        for (const [key, meta] of ObjectUtilities.entries(propMeta)) {
            if (meta.exclude === true && context === 'response') {
                continue;
            }
            if (this.isRequiredInSchema(meta, context)) {
                required.push(key);
            }
            switch (meta.type) {
                case 'date': {
                    properties[key] = {
                        type: 'string',
                        format: 'date-time',
                        description: meta.description
                        // default: meta.default
                    };
                    continue;
                }
                case 'number': {
                    properties[key] = this.numberSchema(meta, meta.default);
                    continue;
                }
                case 'boolean': {
                    properties[key] = this.booleanSchema(meta, meta.default);
                    continue;
                }
                case 'file': {
                    properties[key] = { type: 'string', format: 'binary', description: meta.description };
                    continue;
                }
                case 'string': {
                    properties[key] = this.stringSchema(meta, meta.default);
                    continue;
                }
                case 'object': {
                    const targetClass: Newable<unknown> = meta.cls();
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    const objectSchema: OpenApiSchemaObject
                        = this.buildOpenApiSchemaForProperties(objectPropMeta, targetClass, context, visited);
                    properties[key] = {
                        ...objectSchema,
                        // don't let an explicit (but absent) meta.description blank out the cycle guard's own message
                        description: meta.description ?? objectSchema.description
                    };
                    continue;
                }
                case Relation.HAS_ONE:
                case Relation.BELONGS_TO_ONE:
                case Relation.MANY_TO_ONE: {
                    // getTargetClassForRelation returns a fresh OmitClass-derived class on every call (used here
                    // only to strip the inverse back-reference key), so it can never match a previously visited
                    // entry in `visited` — cycle tracking must key off the real, stable target class instead.
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    const objectSchema: OpenApiSchemaObject
                        = this.buildOpenApiSchemaForProperties(objectPropMeta, meta.target(), context, visited);
                    properties[key] = {
                        ...objectSchema,
                        description: meta.description ?? objectSchema.description
                    };
                    continue;
                }
                case Relation.MANY_TO_MANY:
                case Relation.ONE_TO_MANY: {
                    const targetClass: Newable<BaseEntity> = this.getTargetClassForRelation(meta, entity);
                    const objectPropMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
                    const itemSchema: OpenApiSchemaObject
                        = this.buildOpenApiSchemaForProperties(objectPropMeta, meta.target(), context, visited);
                    properties[key] = {
                        type: 'array',
                        description: meta.description,
                        items: itemSchema
                    };
                    continue;
                }
                case 'array': {
                    // See the comment on the MANY_TO_MANY/ONE_TO_MANY case above for why this needs a fresh class.
                    const items: OpenApiSchemaObject = this.buildOpenApiSchemaForProperties(
                        { items: meta.items },
                        class {},
                        context,
                        visited
                    );
                    properties[key] = {
                        type: 'array',
                        description: meta.description,
                        items: items.properties?.['items']
                    };
                    continue;
                }
                case 'unknown': {
                    properties[key] = {
                        ...meta,
                        type: undefined,
                        required: undefined
                    };
                    continue;
                }
                case 'oneOf': {
                    // exactly one matches, since a value names its shape. Built one shape at a time
                    // through the same fresh-class route arrays take, see there
                    properties[key] = {
                        description: meta.description,
                        oneOf: ObjectUtilities.entries(meta.shapes).map(([name, shape]) => ({
                            type: 'object',
                            properties: {
                                shape: { type: 'string', enum: [name] },
                                value: this.buildOpenApiSchemaForProperties({ shape }, class {}, context, visited)
                                    .properties?.['shape'] ?? {}
                            },
                            required: ['shape', 'value']
                        }))
                        // no discriminator: one without a mapping is defined for named schemas only, and
                        // the enum of each shape's name tells them apart already
                    };
                    continue;
                }
                default: {
                    throw new InternalError(`Unknown property type "${(meta as PropertyMetadata).type}"`);
                }
            }
        }
        // only the classes above this one make a cycle - a sibling property may describe the same class again
        visited.delete(entity);
        this.annotateXml(properties, entity);
        // validation takes null for a property that may be left out, and a read answers with it for one
        // that holds nothing, so the document says so
        for (const [key, meta] of ObjectUtilities.entries(propMeta)) {
            const schema: OpenApiSchemaObject | undefined = properties[key];
            // a property a partial model may leave out takes no null when given, as its base does not
            if (schema != undefined && meta.required !== true && !isRequiredWhenGiven(meta.required)) {
                properties[key] = this.allowNull(schema);
            }
        }

        return {
            type: 'object',
            properties,
            // only include `required` if non-empty
            ...required.length ? { required } : {}
        };
    }

    /**
     * Whether a property is listed as required in the schema of its model.
     * @param meta - The metadata of the property.
     * @param context - Whether the value is sent or answered with.
     * @returns True when it has to be given, has no default, and is not excluded where it is sent.
     */
    private static isRequiredInSchema(meta: PropertyMetadata, context: 'request' | 'response'): boolean {
        return (typeof meta.required === 'boolean' ? meta.required : false)
            && (!('default' in meta) || meta.default == undefined)
            && (meta.exclude === false || context === 'response');
    }

    /**
     * The schema of a value that may be null as well.
     * @param schema - The schema of the value.
     * @returns The schema with null added to its type, or as one more thing it may be when it has none.
     */
    private static allowNull(schema: OpenApiSchemaObject): OpenApiSchemaObject {
        if (schema.type != undefined) {
            const types: OpenApiSchemaObjectType[] = Array.isArray(schema.type) ? schema.type : [schema.type];
            return {
                ...schema,
                type: types.includes('null') ? types : [...types, 'null'],
                // an enum restricts the value whatever the type says, so it has to name null too
                ...schema.enum == undefined || schema.enum.includes(null) ? {} : { enum: [...schema.enum, null] }
            };
        }
        // one of no declared type, such as `unknown`, takes null already
        if (schema.oneOf == undefined && schema.anyOf == undefined) {
            return schema;
        }
        const { description, ...shapes } = schema;
        return { description, anyOf: [shapes, { type: 'null' }] };
    }

    private static getTargetClassForRelation(
        meta: OneToManyPropertyMetadata<BaseEntity>
            | ManyToManyPropertyMetadata<BaseEntity>
            | ManyToOnePropertyMetadata<BaseEntity>
            | BelongsToOnePropertyMetadata<BaseEntity>
            | HasOnePropertyMetadata<BaseEntity>,
        entity: Newable<unknown>
    ): Newable<BaseEntity> {
        const fullTargetClass: Newable<BaseEntity> = meta.target();

        const excludeKeys: (keyof Newable<unknown>)[] = [];
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(fullTargetClass);
        for (const [key, property] of ObjectUtilities.entries(properties)) {
            if (
                property.type !== Relation.BELONGS_TO_ONE
                && property.type !== Relation.HAS_ONE
                && property.type !== Relation.ONE_TO_MANY
                && property.type !== Relation.MANY_TO_ONE
                && property.type !== Relation.MANY_TO_MANY
            ) {
                continue;
            }
            if (property.target() === entity) {
                excludeKeys.push(key as keyof Newable<unknown>);
            }
        }

        const targetClass: Newable<BaseEntity> = OmitClass(fullTargetClass, excludeKeys);
        return targetClass;
    }

    /**
     * The schema of a single parameter, or of the items inside an array one.
     *
     * Takes the item metadata as well as the parameter metadata, which is what an array recurses on.
     * The two differ only in that an item has no name of its own, and nothing here reads one.
     * @param meta - The parameter, or the items of an array parameter.
     * @returns Its schema.
     */
    private static paramToSchema(
        meta: QueryParamMetadata | PathParamMetadata | HeaderParamMetadata | ArrayParamItemMetadata
    ): OpenApiSchemaObject {
        switch (meta.type) {
            case 'boolean': {
                return this.booleanSchema(meta, undefined);
            }
            case 'number': {
                return this.numberSchema(meta, undefined);
            }
            case 'string': {
                return this.stringSchema(meta, undefined);
            }
            case 'date': {
                return {
                    type: 'string',
                    format: 'date-time',
                    description: meta.description
                };
            }
            case 'object': {
                const propMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(meta.cls());
                return {
                    description: meta.description,
                    ...this.buildOpenApiSchemaForProperties(propMeta, meta.cls(), 'request', new Set())
                };
            }
            case 'array': {
                return {
                    type: 'array',
                    description: meta.description,
                    // the items, not the array itself. Recursing on `meta` never reached a leaf and
                    // ran until the stack gave out
                    items: this.paramToSchema(meta.items)
                };
            }
            case 'oneOf': {
                return this.buildAnyOfSchema(meta.shapes, meta.description, 'request');
            }
        }
    }

    // built from the fields the openapi schema object defines, never by spreading the declaration: a
    // property's metadata also carries what only the framework reads - `encryption`, `hash`,
    // `primary`, `index` - and a parameter's carries its own name, none of which belong in a document
    // the framework publishes
    private static stringSchema(meta: StringSchemaSource, defaultValue: unknown): OpenApiSchemaObject {
        return {
            type: 'string',
            format: meta.format,
            description: meta.description,
            minLength: meta.minLength,
            maxLength: meta.maxLength,
            // the pattern without its delimiters and flags: `/^[a-z]+$/` written as it is would ask
            // a client for the slashes as well
            pattern: meta.regex instanceof RegExp ? meta.regex.source : meta.regex,
            enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined,
            ...this.defaultSchemaValue(defaultValue)
        };
    }

    private static numberSchema(meta: NumberSchemaSource, defaultValue: unknown): OpenApiSchemaObject {
        return {
            ...this.openApiNumberType(meta.format),
            description: meta.description,
            minimum: meta.min,
            maximum: meta.max,
            enum: meta.enum ? ObjectUtilities.values(meta.enum) : undefined,
            ...this.defaultSchemaValue(defaultValue)
        };
    }

    private static booleanSchema(meta: BooleanSchemaSource, defaultValue: unknown): OpenApiSchemaObject {
        return { type: 'boolean', description: meta.description, ...this.defaultSchemaValue(defaultValue) };
    }

    // a default computed per request is a function, and a document can only state a value
    private static defaultSchemaValue(defaultValue: unknown): Pick<OpenApiSchemaObject, 'default'> {
        return defaultValue == undefined || typeof defaultValue === 'function' ? {} : { default: defaultValue };
    }

    private static openApiNumberType(format: NumberFormat): OpenApiNumberType {
        switch (format) {
            case 'number': {
                return { type: 'number', format: 'double' };
            }
            case 'integer': {
                return { type: 'integer', format: 'int64' };
            }
            case 'bigint': {
                return { type: 'string', format: 'int64' };
            }
            case 'bignumber': {
                return { type: 'string', format: 'decimal' };
            }
        }
    }
}