import { JsonUtilities, OpenApiExplorerOperation, OpenApiExplorerSchemaSource, OpenApiExplorerSecurityScheme, OpenApiExplorerUtilities, OpenApiMediaTypeObject, OpenApiParameterObject, OpenApiRequestBodyObject, OpenApiSchemaObject, TsxComponent, useContext } from 'zibri';

import { ExplorerContent } from './explorer-content';
import { ExplorerDefinition } from './explorer-context';
import { ExplorerLock } from './explorer-lock';
import { ExplorerMethodClasses, resolveMethodClasses } from './explorer-methods';
import { ExplorerCredentialScheme, ExplorerFormField, ExplorerRequestBody, ExplorerRequestParameter, ExplorerTryItOut } from './explorer-try-it-out';
import { Heading } from '../components/heading';

type Props = {
    operation: OpenApiExplorerOperation,
    schemes: OpenApiExplorerSecurityScheme[],
    version: string,
    versionHeader: string
};

/**
 * The media types a body is sent as in a form, field by field.
 */
const FORM_MIME_TYPES: string[] = ['multipart/form-data', 'application/x-www-form-urlencoded'];

/**
 * A media type as a part of an id.
 * @param mimeType - The media type, such as `application/json`.
 * @returns The media type with what an id cannot hold replaced, such as `application-json`.
 */
function toKey(mimeType: string): string {
    return mimeType.replaceAll(/[^\w-]+/g, '-');
}

/**
 * The text a value of a field starts with.
 * @param value - The value the document states.
 * @returns The text, empty when it states none.
 */
function toText(value: unknown): string {
    if (value == undefined) {
        return '';
    }
    return typeof value === 'object' ? JsonUtilities.stringify(value) : String(value);
}

/**
 * Whether a schema describes a list.
 * @param schema - The schema.
 * @returns True for a list.
 */
function isArray(schema: OpenApiSchemaObject | undefined): boolean {
    return schema?.type === 'array' || (Array.isArray(schema?.type) && schema.type.includes('array'));
}

/**
 * The parameter as the form asks for it.
 * @param definition - The document.
 * @param parameter - The parameter.
 * @returns The parameter.
 */
function toRequestParameter(definition: OpenApiExplorerSchemaSource, parameter: OpenApiParameterObject): ExplorerRequestParameter {
    const schema: OpenApiSchemaObject | undefined = parameter.schema == undefined
        ? undefined
        : OpenApiExplorerUtilities.resolveSchema(definition, parameter.schema);
    return {
        name: parameter.name,
        location: parameter.in,
        required: parameter.required === true,
        deprecated: parameter.deprecated === true,
        description: parameter.description ?? schema?.description ?? '',
        typeName: parameter.schema == undefined ? 'string' : OpenApiExplorerUtilities.resolveTypeName(definition, parameter.schema),
        value: OpenApiExplorerUtilities.resolveParameterValue(definition, parameter),
        options: isArray(schema) ? [] : (schema?.enum ?? []).filter(option => option != undefined).map(option => toText(option)),
        isArray: isArray(schema)
    };
}

/**
 * The fields of a form body.
 * @param definition - The document.
 * @param content - The content of the form.
 * @returns A field for each property of its schema.
 */
function toFormFields(definition: OpenApiExplorerSchemaSource, content: OpenApiMediaTypeObject): ExplorerFormField[] {
    const schema: OpenApiSchemaObject | undefined = content.schema == undefined ? undefined : OpenApiExplorerUtilities.resolveSchema(definition, content.schema);
    return Object.entries(schema?.properties ?? {}).map(([name, declared]) => {
        const property: OpenApiSchemaObject = OpenApiExplorerUtilities.resolveSchema(definition, declared);
        const items: OpenApiSchemaObject | undefined = property.items == undefined ? undefined : OpenApiExplorerUtilities.resolveSchema(definition, property.items);
        const isFile: boolean = property.format === 'binary' || items?.format === 'binary';
        return {
            name,
            required: schema?.required?.includes(name) === true,
            description: property.description ?? '',
            typeName: OpenApiExplorerUtilities.resolveTypeName(definition, declared),
            value: isFile ? '' : toText(property.default ?? property.example),
            isFile,
            isArray: isArray(property)
        };
    });
}

/**
 * The media types a request body can be sent as.
 * @param definition - The document.
 * @param body - The request body, if the operation takes one.
 * @returns One entry for each media type.
 */
function toRequestBodies(definition: OpenApiExplorerSchemaSource, body: OpenApiRequestBodyObject | undefined): ExplorerRequestBody[] {
    return Object.entries(body?.content ?? {}).map(([mimeType, content]) => {
        const isForm: boolean = FORM_MIME_TYPES.includes(mimeType);
        return {
            mimeType,
            key: toKey(mimeType),
            example: isForm ? '' : OpenApiExplorerUtilities.resolveContentExample(definition, mimeType, content, 'request'),
            fields: isForm ? toFormFields(definition, content) : [],
            isForm,
            schema: content.schema
        };
    });
}

/**
 * The media types the operation answers with, which a request can ask for.
 * @param operation - The operation.
 * @returns The media types, in the order of the document.
 */
function resolveAccepts(operation: OpenApiExplorerOperation): string[] {
    return [...new Set(operation.responses.flatMap(({ response }) => Object.keys(response.content ?? {})))];
}

/**
 * The schemes of the operation, as a request applies them.
 * @param operation - The operation.
 * @param schemes - The schemes of the document.
 * @returns The schemes the operation accepts.
 */
function toCredentialSchemes(operation: OpenApiExplorerOperation, schemes: OpenApiExplorerSecurityScheme[]): ExplorerCredentialScheme[] {
    return schemes
        .filter(({ name }) => operation.securitySchemes.includes(name))
        .map(({ name, scheme }) => ({
            name,
            type: scheme.type,
            scheme: scheme.scheme ?? '',
            location: scheme.in ?? '',
            parameterName: scheme.name ?? ''
        }));
}

export const ExplorerOperation: TsxComponent<Props> = ({ operation, schemes, version, versionHeader }) => {
    const definition: OpenApiExplorerSchemaSource = useContext(ExplorerDefinition);
    const classes: ExplorerMethodClasses = resolveMethodClasses(operation.method);

    return (
        <details id={operation.id} className={`my-2 rounded border ${classes.frame}`}>
            <summary className="flex flex-wrap gap-3 items-center p-1.5 cursor-pointer">
                <span className={`min-w-20 py-1.5 rounded-sm text-center font-bold text-[#111] ${classes.badge}`}>{operation.method.toUpperCase()}</span>
                <span id={`${operation.id}-path`} className={operation.deprecated ? 'font-mono font-semibold break-all line-through' : 'font-mono font-semibold break-all'}>
                    {operation.path}
                </span>
                <span className="flex-1 text-disabled">{operation.summary}</span>
                <span id={`${operation.id}-permissions`} className="flex gap-2 items-center">
                    {operation.permissions.map(permission => <span className="px-2 pb-0.5 rounded-full border border-white bg-dark-gray text-sm">{permission}</span>)}
                </span>
                {operation.securitySchemes.length > 0 && <ExplorerLock id={`${operation.id}-lock`} schemes={operation.securitySchemes}/>}
            </summary>
            <div className={`flex flex-col gap-3 px-4 pt-3 pb-4 border-t ${classes.frame}`}>
                {operation.deprecated && <p className="font-semibold text-[#fca130]">Deprecated</p>}
                {operation.description != undefined && <p>{operation.description}</p>}
                <ExplorerTryItOut
                    id={operation.id}
                    method={operation.method}
                    path={operation.path}
                    version={version}
                    versionHeader={versionHeader}
                    parameters={operation.parameters.map(parameter => toRequestParameter(definition, parameter))}
                    bodies={toRequestBodies(definition, operation.requestBody)}
                    bodyRequired={operation.requestBody?.required === true}
                    bodyDescription={operation.requestBody?.description ?? ''}
                    accepts={resolveAccepts(operation)}
                    schemes={toCredentialSchemes(operation, schemes)}
                />
                <Heading tag="h4" className="text-lg! font-semibold">Responses</Heading>
                <table className="w-full border-collapse">
                    <thead>
                        <tr>
                            <th className="text-left py-1.5 px-1 border-b border-gray">Status</th>
                            <th className="text-left py-1.5 px-1 border-b border-gray">Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        {operation.responses.map(({ status, response, headers }) => <tr id={`${operation.id}-response-${status}`}>
                            <td className="w-20 align-top py-2 px-1 border-b border-gray font-bold">{status}</td>
                            <td className="align-top py-2 px-1 border-b border-gray">
                                {response.description !== '' && <p>{response.description}</p>}
                                {headers.length > 0 && <div className="my-2">
                                    <h5 className="font-semibold">Headers</h5>
                                    {headers.map(({ name, header }) => <div className="font-mono text-sm">
                                        <span className="font-semibold">{name}</span>
                                        {header.schema != undefined && <span className="text-secondary"> {OpenApiExplorerUtilities.resolveTypeName(definition, header.schema)}</span>}
                                        {header.description != undefined && <span className="font-sans text-disabled"> {header.description}</span>}
                                    </div>)}
                                </div>}
                                {Object.entries(response.content ?? {}).map(([mimeType, content]) => <ExplorerContent
                                    id={`${operation.id}-response-${status}-${toKey(mimeType)}`}
                                    mimeType={mimeType}
                                    content={content}
                                    direction="response"
                                />)}
                            </td>
                        </tr>)}
                    </tbody>
                </table>
            </div>
        </details>
    );
};