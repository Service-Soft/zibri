import { OpenApiExplorerHeader, OpenApiExplorerMethod, OpenApiExplorerOperation, OpenApiExplorerResponse, OpenApiExplorerTag } from './open-api-explorer-operation.model';
import { OpenApiExplorerSecurityScheme } from './open-api-explorer-security-scheme.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { HtmlUtilities } from '../../parsing/html/html.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { isOpenApiReferenceObject, OpenApiDefinition, OpenApiHeaderObject, OpenApiMediaTypeObject, OpenApiOperation, OpenApiParameterObject, OpenApiReferenceObject, OpenApiRequestBodyObject, OpenApiResponseObject, OpenApiSchemaObject, OpenApiSchemaObjectType, OpenApiSecuritySchemeObject } from '../open-api.model';

/**
 * A document whose schemas the explorer reads: an OpenAPI or an AsyncAPI document, whose references to schemas point
 * into `components.schemas`.
 */
export type OpenApiExplorerSchemaSource = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    components?: {
        // eslint-disable-next-line jsdoc/require-jsdoc
        schemas?: Record<string, OpenApiSchemaObject | OpenApiReferenceObject>
    }
};

/**
 * Whether an example is of a value sent in a request, which leaves out what is read only, or of one answered with,
 * which leaves out what is write only.
 */
export type OpenApiExampleDirection = 'request' | 'response';

/**
 * The methods in the order the explorer lists the operations of one path.
 */
const METHODS: OpenApiExplorerMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/**
 * The tag of the operations that name none.
 */
const DEFAULT_TAG: string = 'default';

/**
 * Where an XML document starts.
 */
const XML_DECLARATION: string = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * What the explorer page reads from an OpenAPI document while it renders: the operations by tag, the schemes, and
 * what a schema looks like and what a value of it looks like.
 *
 * Only references to `#/components/...` of the document itself are followed. Any other reference, and one naming
 * a component the document does not have, throws, naming the reference.
 */
export abstract class OpenApiExplorerUtilities {
    /**
     * Resolves the operations of a document, by tag: the tags the document lists first, in its order, then those
     * only its operations name, and `default` for the operations that name none. A tag without operations is left out.
     * @param definition - The document.
     * @returns The tags with their operations.
     */
    static resolveTags(definition: OpenApiDefinition): OpenApiExplorerTag[] {
        const tags: Map<string, OpenApiExplorerTag> = new Map();
        for (const tag of definition.tags ?? []) {
            tags.set(tag.name, { name: tag.name, description: tag.description, operations: [] });
        }
        for (const [path, item] of ObjectUtilities.entries(definition.paths ?? {})) {
            // a key of an extension, such as `x-internal`, is no path
            if (!path.startsWith('/')) {
                continue;
            }
            for (const method of METHODS) {
                const operation: OpenApiOperation | undefined = item[method];
                if (operation == undefined) {
                    continue;
                }
                for (const name of operation.tags?.length ? operation.tags : [DEFAULT_TAG]) {
                    const tag: OpenApiExplorerTag = tags.get(name) ?? { name, description: undefined, operations: [] };
                    tags.set(name, tag);
                    tag.operations.push(this.resolveOperation(definition, name, path, method, item.parameters ?? [], operation));
                }
            }
        }
        return [...tags.values()].filter(tag => tag.operations.length);
    }

    /**
     * Resolves the security schemes of a document.
     * @param definition - The document.
     * @returns Each scheme under its name, in the order of the document.
     */
    static resolveSecuritySchemes(definition: OpenApiDefinition): OpenApiExplorerSecurityScheme[] {
        const schemes: Record<string, OpenApiSecuritySchemeObject | OpenApiReferenceObject> = definition.components?.securitySchemes ?? {};
        return ObjectUtilities.entries(schemes).map(([name, scheme]) => ({
            name,
            scheme: this.resolveComponent(definition.components?.securitySchemes, 'securitySchemes', scheme)
        }));
    }

    /**
     * Resolves a schema that may be a reference.
     * @param definition - The document the schema is part of.
     * @param schema - The schema, or a reference to one.
     * @returns The schema.
     */
    static resolveSchema(
        definition: OpenApiExplorerSchemaSource,
        schema: OpenApiSchemaObject | OpenApiReferenceObject
    ): OpenApiSchemaObject {
        return this.resolveComponent(definition.components?.schemas, 'schemas', schema);
    }

    /**
     * Resolves the name a reference gives the schema it refers to.
     * @param schema - The schema, or a reference to one.
     * @returns The name of the component, such as `Item` for `#/components/schemas/Item`, or undefined when the
     * schema is no reference.
     */
    static findReferenceName(schema: OpenApiSchemaObject | OpenApiReferenceObject): string | undefined {
        return isOpenApiReferenceObject(schema) ? this.decodePointer(schema.$ref.slice(schema.$ref.lastIndexOf('/') + 1)) : undefined;
    }

    /**
     * Resolves a short name for the type of a schema, such as `string (date-time) | null`, `Item[]` or `one of`.
     * @param definition - The document the schema is part of.
     * @param schema - The schema, or a reference to one.
     * @returns The name of its type.
     */
    static resolveTypeName(definition: OpenApiExplorerSchemaSource, schema: OpenApiSchemaObject | OpenApiReferenceObject): string {
        const referenceName: string | undefined = this.findReferenceName(schema);
        if (referenceName != undefined) {
            return referenceName;
        }
        const resolved: OpenApiSchemaObject = this.resolveSchema(definition, schema);
        if (resolved.oneOf != undefined) {
            return 'one of';
        }
        if (resolved.anyOf != undefined) {
            return 'any of';
        }
        if (resolved.allOf != undefined) {
            return 'all of';
        }
        const types: OpenApiSchemaObjectType[] = this.resolveTypes(resolved);
        if (!types.length) {
            return resolved.properties == undefined ? 'any' : 'object';
        }
        return types.map(type => {
            switch (type) {
                case 'array': {
                    return `${resolved.items == undefined ? 'any' : this.resolveTypeName(definition, resolved.items)}[]`;
                }
                case 'null': {
                    return 'null';
                }
                case 'integer':
                case 'number':
                case 'string':
                case 'boolean':
                case 'object': {
                    return resolved.format == undefined ? type : `${type} (${resolved.format})`;
                }
            }
        }).join(' | ');
    }

    /**
     * Resolves a value a schema describes: its example, its default or its first allowed value where it states
     * one, and a value of its type otherwise.
     * @param definition - The document the schema is part of.
     * @param schema - The schema, or a reference to one.
     * @param direction - Whether the value is sent or answered with.
     * @returns The value. Undefined for a schema that refers to itself, at the point it does.
     */
    static resolveExample(
        definition: OpenApiExplorerSchemaSource,
        schema: OpenApiSchemaObject | OpenApiReferenceObject,
        direction: OpenApiExampleDirection
    ): unknown {
        return this.buildExample(definition, schema, direction, []);
    }

    /**
     * Resolves the example of one media type of a request body or a response as the text it is sent as: its own
     * example where it has one, and the example of its schema otherwise, as json, xml or plain text.
     * @param definition - The document the content is part of.
     * @param mimeType - The media type, such as `application/json`.
     * @param content - The content of that media type.
     * @param direction - Whether the content is sent or answered with.
     * @returns The text, empty for content that has no text, such as a file.
     */
    static resolveContentExample(
        definition: OpenApiExplorerSchemaSource,
        mimeType: string,
        content: OpenApiMediaTypeObject,
        direction: OpenApiExampleDirection
    ): string {
        const stated: unknown = this.findStatedExample(content);
        const schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined = content.schema;
        if (stated === undefined && schema == undefined) {
            return '';
        }
        if (this.isXml(mimeType)) {
            if (typeof stated === 'string') {
                return stated;
            }
            return schema == undefined ? '' : this.resolveXmlExample(definition, schema);
        }
        const value: unknown = stated === undefined && schema != undefined ? this.resolveExample(definition, schema, direction) : stated;
        if (this.isJson(mimeType)) {
            return JsonUtilities.stringify(value, undefined, 2);
        }
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
    }

    /**
     * Resolves the text a parameter starts with in a form: its default or its example, where it states one.
     * @param definition - The document the parameter is part of.
     * @param parameter - The parameter.
     * @returns The text, empty when the parameter states neither. An array is written separated by commas.
     */
    static resolveParameterValue(definition: OpenApiExplorerSchemaSource, parameter: OpenApiParameterObject): string {
        const schema: OpenApiSchemaObject | undefined = parameter.schema == undefined
            ? undefined
            : this.resolveSchema(definition, parameter.schema);
        const stated: unknown = parameter.example ?? this.findFirstExample(parameter.examples) ?? schema?.default ?? schema?.example;
        return Array.isArray(stated) ? stated.map(item => this.toText(item)).join(',') : this.toText(stated);
    }

    /**
     * Resolves an example of a schema as an xml document, its elements, attributes and namespaces named as the
     * `xml` of each schema says.
     * @param definition - The document the schema is part of.
     * @param schema - The schema of the root element, or a reference to one. Of several, the first.
     * @returns The document.
     */
    static resolveXmlExample(definition: OpenApiExplorerSchemaSource, schema: OpenApiSchemaObject | OpenApiReferenceObject): string {
        const root: OpenApiSchemaObject | OpenApiReferenceObject = this.findFirstShape(definition, schema);
        const resolved: OpenApiSchemaObject = this.resolveSchema(definition, root);
        const name: string = resolved.xml?.name ?? this.findReferenceName(root) ?? 'root';
        return `${XML_DECLARATION}\n${this.buildXmlElement(definition, name, root, 0, [], new Map())}`;
    }

    private static resolveOperation(
        definition: OpenApiDefinition,
        tag: string,
        path: string,
        method: OpenApiExplorerMethod,
        pathParameters: (OpenApiParameterObject | OpenApiReferenceObject)[],
        operation: OpenApiOperation
    ): OpenApiExplorerOperation {
        const parameters: OpenApiParameterObject[] = [];
        // the operation's own parameters take the place of the path's of the same name and location
        for (const parameter of [...operation.parameters ?? [], ...pathParameters]) {
            const resolved: OpenApiParameterObject = this.resolveComponent(definition.components?.parameters, 'parameters', parameter);
            if (!parameters.some(other => other.name === resolved.name && other.in === resolved.in)) {
                parameters.push(resolved);
            }
        }
        return {
            id: `${tag}-${method}-${path}`.replaceAll(/[^\w-]+/g, '-'),
            method,
            path,
            summary: operation.summary,
            description: operation.description,
            deprecated: operation.deprecated === true,
            parameters,
            requestBody: operation.requestBody == undefined
                ? undefined
                : this.resolveComponent<OpenApiRequestBodyObject>(
                    definition.components?.requestBodies,
                    'requestBodies',
                    operation.requestBody
                ),
            responses: this.resolveResponses(definition, operation),
            securitySchemes: [...new Set((operation.security ?? definition.security ?? []).flatMap(requirement => ObjectUtilities.keys(requirement)))],
            permissions: [
                operation['x-permission'],
                operation['x-platform-permission']
            ].filter(permission => typeof permission === 'string')
        };
    }

    private static resolveResponses(definition: OpenApiDefinition, operation: OpenApiOperation): OpenApiExplorerResponse[] {
        const responses: OpenApiExplorerResponse[] = [];
        for (const [status, value] of ObjectUtilities.entries(operation.responses ?? {})) {
            if (status.startsWith('x-')) {
                continue;
            }
            // the index of the responses object types every status as anything, as it shares it with the extensions
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const declared: OpenApiResponseObject | OpenApiReferenceObject = value;
            const response: OpenApiResponseObject = this.resolveComponent(definition.components?.responses, 'responses', declared);
            const headers: OpenApiExplorerHeader[] = ObjectUtilities.entries(response.headers ?? {}).map(([name, header]) => ({
                name,
                header: this.resolveComponent<OpenApiHeaderObject>(definition.components?.headers, 'headers', header)
            }));
            responses.push({ status, response, headers });
        }
        // `default` last, after the statuses in order
        return responses.sort((a, b) => a.status === b.status ? 0 : a.status === 'default' ? 1 : b.status === 'default' ? -1 : a.status.localeCompare(b.status));
    }

    /**
     * Resolves a value that may be a reference to a component of the document.
     * @param components - The components of its kind.
     * @param kind - The kind, as the reference names it, such as `schemas`.
     * @param value - The value, or a reference.
     * @returns The value.
     * @throws An InternalError for a reference the document cannot resolve, or one that refers to itself.
     */
    private static resolveComponent<T extends object>(
        components: Record<string, T | OpenApiReferenceObject> | undefined,
        kind: string,
        value: T | OpenApiReferenceObject
    ): T {
        let current: T | OpenApiReferenceObject = value;
        const seen: string[] = [];
        while (isOpenApiReferenceObject(current)) {
            const reference: string = current.$ref;
            if (seen.includes(reference)) {
                throw new InternalError(`The OpenAPI document refers from "${reference}" to itself: ${[...seen, reference].join(' -> ')}.`);
            }
            seen.push(reference);
            const prefix: string = `#/components/${kind}/`;
            const found: T | OpenApiReferenceObject | undefined = reference.startsWith(prefix)
                ? components?.[this.decodePointer(reference.slice(prefix.length))]
                : undefined;
            if (found == undefined) {
                throw new InternalError(`The OpenAPI document refers to "${reference}", which is none of its components.${kind}.`);
            }
            current = found;
        }
        return current;
    }

    /**
     * Decodes one segment of a json pointer, in which `~1` stands for `/` and `~0` for `~`.
     * @param segment - The segment.
     * @returns The name it stands for.
     */
    private static decodePointer(segment: string): string {
        return segment.replaceAll('~1', '/').replaceAll('~0', '~');
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private static buildExample(
        definition: OpenApiExplorerSchemaSource,
        schema: OpenApiSchemaObject | OpenApiReferenceObject,
        direction: OpenApiExampleDirection,
        references: string[]
    ): unknown {
        if (isOpenApiReferenceObject(schema)) {
            return references.includes(schema.$ref)
                ? undefined
                : this.buildExample(definition, this.resolveSchema(definition, schema), direction, [...references, schema.$ref]);
        }
        const stated: unknown = schema.example
            ?? schema.examples?.[0]
            ?? schema.const
            ?? schema.default
            ?? schema.enum?.find(value => value !== null);
        if (stated !== undefined) {
            return stated;
        }
        if (schema.allOf != undefined) {
            return Object.assign({}, ...schema.allOf.map(part => this.buildExample(definition, part, direction, references)));
        }
        const shapes: (OpenApiSchemaObject | OpenApiReferenceObject)[] | undefined = schema.oneOf ?? schema.anyOf;
        if (shapes != undefined) {
            const shape: OpenApiSchemaObject | OpenApiReferenceObject | undefined = shapes.find(s => !this.isNull(definition, s));
            return shape == undefined ? null : this.buildExample(definition, shape, direction, references);
        }
        const types: OpenApiSchemaObjectType[] = this.resolveTypes(schema);
        const type: OpenApiSchemaObjectType | undefined = types.find(t => t !== 'null')
            ?? types[0]
            ?? (schema.properties == undefined ? undefined : 'object');
        switch (type) {
            case 'object': {
                const value: Record<string, unknown> = {};
                for (const [key, property] of ObjectUtilities.entries(schema.properties ?? {})) {
                    const resolved: OpenApiSchemaObject = this.resolveSchema(definition, property);
                    if ((direction === 'request' && resolved.readOnly === true) || (direction === 'response' && resolved.writeOnly === true)) {
                        continue;
                    }
                    const example: unknown = this.buildExample(definition, property, direction, references);
                    if (example !== undefined) {
                        value[key] = example;
                    }
                }
                if (typeof schema.additionalProperties === 'object') {
                    value['additionalProperty'] = this.buildExample(definition, schema.additionalProperties, direction, references);
                }
                return value;
            }
            case 'array': {
                const item: unknown = schema.items == undefined ? undefined : this.buildExample(definition, schema.items, direction, references);
                return item === undefined ? [] : [item];
            }
            case 'string': {
                // a string holding an xml document, such as the body of a websocket message
                return schema.contentSchema != undefined && schema.contentMediaType != undefined && this.isXml(schema.contentMediaType)
                    ? this.resolveXmlExample(definition, schema.contentSchema)
                    : this.buildStringExample(schema.format);
            }
            case 'number':
            case 'integer': {
                return schema.minimum ?? schema.exclusiveMinimum ?? 0;
            }
            case 'boolean': {
                return true;
            }
            case 'null': {
                return null;
            }
            case undefined: {
                return {};
            }
        }
    }

    private static buildStringExample(format: string | undefined): string {
        switch (format) {
            case 'date-time': {
                return new Date().toISOString();
            }
            case 'date': {
                return new Date().toISOString()
                    .slice(0, 10);
            }
            case 'email': {
                return 'user@example.com';
            }
            case 'uuid': {
                return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
            }
            case 'uri':
            case 'url': {
                return 'https://example.com';
            }
            case 'int64':
            case 'decimal': {
                return '0';
            }
            case 'binary':
            case 'byte': {
                return '';
            }
            default: {
                return 'string';
            }
        }
    }

    /**
     * Builds one element of an xml example, and the elements inside it.
     * @param definition - The document the schema is part of.
     * @param name - The name of the element.
     * @param schema - The schema of the element.
     * @param depth - How deep the element is, which it is indented by.
     * @param references - The references passed on the way here, so a schema that refers to itself ends.
     * @param namespaces - The namespace of each prefix declared above, `''` standing for the default one.
     * @returns The element, empty for a schema that refers to itself, at the point it does.
     */
    // eslint-disable-next-line sonar/cognitive-complexity
    private static buildXmlElement(
        definition: OpenApiExplorerSchemaSource,
        name: string,
        schema: OpenApiSchemaObject | OpenApiReferenceObject,
        depth: number,
        references: string[],
        namespaces: ReadonlyMap<string, string>
    ): string {
        const indent: string = '    '.repeat(depth);
        const shape: OpenApiSchemaObject | OpenApiReferenceObject = this.findFirstShape(definition, schema);
        const reference: string | undefined = isOpenApiReferenceObject(shape) ? shape.$ref : undefined;
        if (reference != undefined && references.includes(reference)) {
            return '';
        }
        const nextReferences: string[] = reference == undefined ? references : [...references, reference];
        const resolved: OpenApiSchemaObject = this.resolveSchema(definition, shape);
        const prefix: string = resolved.xml?.prefix ?? '';
        const qualifiedName: string = prefix === '' ? name : `${prefix}:${name}`;
        const namespace: string | undefined = resolved.xml?.namespace;
        // a namespace is declared where it starts, and the elements inside it inherit the declaration
        const declares: boolean = namespace != undefined && namespaces.get(prefix) !== namespace;
        const declaration: string = declares ? ` xmlns${prefix === '' ? '' : `:${prefix}`}="${HtmlUtilities.escape(namespace ?? '')}"` : '';
        const inner: ReadonlyMap<string, string> = declares ? new Map([...namespaces, [prefix, namespace ?? '']]) : namespaces;

        if (resolved.properties == undefined) {
            const value: unknown = this.buildExample(definition, resolved, 'request', nextReferences);
            return `${indent}<${qualifiedName}${declaration}>${HtmlUtilities.escape(this.toText(value))}</${qualifiedName}>`;
        }

        let attributes: string = '';
        const children: string[] = [];
        for (const [key, property] of ObjectUtilities.entries(resolved.properties)) {
            const resolvedProperty: OpenApiSchemaObject = this.resolveSchema(definition, property);
            if (resolvedProperty.readOnly === true) {
                continue;
            }
            const propertyName: string = resolvedProperty.xml?.name ?? key;
            if (resolvedProperty.xml?.attribute === true) {
                attributes += ` ${propertyName}="${HtmlUtilities.escape(this.toText(this.buildExample(definition, property, 'request', nextReferences)))}"`;
                continue;
            }
            if (this.resolveTypes(resolvedProperty).includes('array') && resolvedProperty.items != undefined) {
                const items: OpenApiSchemaObject | OpenApiReferenceObject = resolvedProperty.items;
                const itemName: string = this.resolveSchema(definition, items).xml?.name ?? propertyName;
                const wrapped: boolean = resolvedProperty.xml?.wrapped === true;
                const item: string = this.buildXmlElement(definition, itemName, items, depth + (wrapped ? 2 : 1), nextReferences, inner);
                children.push(wrapped ? `${indent}    <${propertyName}>\n${item}\n${indent}    </${propertyName}>` : item);
                continue;
            }
            children.push(this.buildXmlElement(definition, propertyName, property, depth + 1, nextReferences, inner));
        }
        const content: string[] = children.filter(child => child.length);
        return content.length
            ? `${indent}<${qualifiedName}${declaration}${attributes}>\n${content.join('\n')}\n${indent}</${qualifiedName}>`
            : `${indent}<${qualifiedName}${declaration}${attributes}/>`;
    }

    private static findFirstShape(
        definition: OpenApiExplorerSchemaSource,
        schema: OpenApiSchemaObject | OpenApiReferenceObject
    ): OpenApiSchemaObject | OpenApiReferenceObject {
        const resolved: OpenApiSchemaObject = this.resolveSchema(definition, schema);
        const shapes: (OpenApiSchemaObject | OpenApiReferenceObject)[] | undefined = resolved.oneOf ?? resolved.anyOf;
        const shape: OpenApiSchemaObject | OpenApiReferenceObject | undefined = shapes?.find(s => !this.isNull(definition, s));
        return shape == undefined ? schema : this.findFirstShape(definition, shape);
    }

    private static resolveTypes(schema: OpenApiSchemaObject): OpenApiSchemaObjectType[] {
        if (schema.type == undefined) {
            return [];
        }
        return Array.isArray(schema.type) ? schema.type : [schema.type];
    }

    private static isNull(definition: OpenApiExplorerSchemaSource, schema: OpenApiSchemaObject | OpenApiReferenceObject): boolean {
        const types: OpenApiSchemaObjectType[] = this.resolveTypes(this.resolveSchema(definition, schema));
        return types.length === 1 && types[0] === 'null';
    }

    private static findStatedExample(content: OpenApiMediaTypeObject): unknown {

        const example: unknown = content.example;
        return example ?? this.findFirstExample(content.examples);
    }

    private static findFirstExample(examples: OpenApiMediaTypeObject['examples']): unknown {
        const first: NonNullable<OpenApiMediaTypeObject['examples']>[string] | undefined = examples == undefined
            ? undefined
            : ObjectUtilities.values(examples)[0];
        return first == undefined || isOpenApiReferenceObject(first) ? undefined : first.value;
    }

    private static toText(value: unknown): string {
        if (value == undefined) {
            return '';
        }
        return typeof value === 'object' ? JsonUtilities.stringify(value) : String(value);
    }

    private static isJson(mimeType: string): boolean {
        return mimeType === 'application/json' || mimeType.endsWith('+json');
    }

    private static isXml(mimeType: string): boolean {
        return mimeType === 'application/xml' || mimeType === 'text/xml' || mimeType.endsWith('+xml');
    }
}