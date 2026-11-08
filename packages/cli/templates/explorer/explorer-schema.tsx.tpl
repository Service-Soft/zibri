import { isOpenApiReferenceObject, JsonUtilities, OpenApiExplorerSchemaSource, OpenApiExplorerUtilities, OpenApiReferenceObject, OpenApiSchemaObject, TsxComponent, TsxElement, useContext } from 'zibri';

import { ExplorerDefinition } from './explorer-context';

type Props = {
    schema: OpenApiSchemaObject | OpenApiReferenceObject,
    name?: string,
    required?: boolean,
    // the references passed on the way here, so a schema that refers to itself is shown once
    references?: string[],
    depth?: number
};

/**
 * What a schema allows besides its type, such as `min 0` or `one of: a, b`.
 * @param schema - The schema.
 * @returns One text for each restriction.
 */
function resolveRestrictions(schema: OpenApiSchemaObject): string[] {
    const restrictions: string[] = [];
    if (schema.enum != undefined) {
        restrictions.push(`one of: ${schema.enum.map(value => JsonUtilities.stringify(value)).join(', ')}`);
    }
    if (schema.default !== undefined) {
        restrictions.push(`default: ${JsonUtilities.stringify(schema.default)}`);
    }
    const bounds: [string, unknown][] = [
        ['min', schema.minimum],
        ['max', schema.maximum],
        ['more than', schema.exclusiveMinimum],
        ['less than', schema.exclusiveMaximum],
        ['min length', schema.minLength],
        ['max length', schema.maxLength],
        ['min items', schema.minItems],
        ['max items', schema.maxItems],
        ['pattern', schema.pattern]
    ];
    for (const [label, value] of bounds) {
        if (value != undefined) {
            restrictions.push(`${label} ${String(value)}`);
        }
    }
    if (schema.readOnly === true) {
        restrictions.push('read only');
    }
    if (schema.writeOnly === true) {
        restrictions.push('write only');
    }
    return restrictions;
}

/**
 * The schemas a schema is made of: its properties, its items, and the shapes it may have.
 * @param definition - The document of the schema.
 * @param schema - The schema.
 * @returns Each part under the name it is shown with, and whether it is required.
 */
function resolveParts(definition: OpenApiExplorerSchemaSource, schema: OpenApiSchemaObject): [string, OpenApiSchemaObject | OpenApiReferenceObject, boolean][] {
    const parts: [string, OpenApiSchemaObject | OpenApiReferenceObject, boolean][] = [];
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
        parts.push([key, property, schema.required?.includes(key) === true]);
    }
    if (schema.items != undefined && OpenApiExplorerUtilities.findReferenceName(schema.items) == undefined) {
        const items: OpenApiSchemaObject = OpenApiExplorerUtilities.resolveSchema(definition, schema.items);
        // the items of a list of objects are shown by their properties, as the list's own
        if (items.properties == undefined && items.oneOf == undefined && items.anyOf == undefined) {
            parts.push(['items', schema.items, false]);
        }
        else {
            parts.push(...resolveParts(definition, items));
        }
    }
    else if (schema.items != undefined) {
        parts.push(['items', schema.items, false]);
    }
    const groups: [string, (OpenApiSchemaObject | OpenApiReferenceObject)[] | undefined][] = [
        ['one of', schema.oneOf],
        ['any of', schema.anyOf],
        ['all of', schema.allOf]
    ];
    for (const [label, shapes] of groups) {
        for (const [index, shape] of (shapes ?? []).entries()) {
            const resolved: OpenApiSchemaObject = OpenApiExplorerUtilities.resolveSchema(definition, shape);
            parts.push([resolved.title ?? `${label} #${index + 1}`, shape, false]);
        }
    }
    if (typeof schema.additionalProperties === 'object') {
        parts.push(['any other key', schema.additionalProperties, false]);
    }
    return parts;
}

export const ExplorerSchema: TsxComponent<Props> = ({ schema, name, required = false, references = [], depth = 0 }) => {
    const definition: OpenApiExplorerSchemaSource = useContext(ExplorerDefinition);
    const reference: string | undefined = isOpenApiReferenceObject(schema) ? schema.$ref : undefined;
    const circular: boolean = reference != undefined && references.includes(reference);
    const resolved: OpenApiSchemaObject | undefined = circular ? undefined : OpenApiExplorerUtilities.resolveSchema(definition, schema);
    const nextReferences: string[] = reference == undefined ? references : [...references, reference];
    const parts: [string, OpenApiSchemaObject | OpenApiReferenceObject, boolean][] = resolved == undefined ? [] : resolveParts(definition, resolved);
    const head: TsxElement = <span className="inline-flex flex-wrap gap-2 items-baseline">
        {name != undefined && <span className={resolved?.deprecated === true ? 'font-semibold line-through' : 'font-semibold'}>{name}</span>}
        {required && <span className="text-[#f93e3e]" title="required">*</span>}
        <span className="text-secondary">{OpenApiExplorerUtilities.resolveTypeName(definition, schema)}</span>
        {circular && <span className="italic text-disabled">refers to itself, shown above</span>}
        {resolved != undefined && resolveRestrictions(resolved).map(restriction => <span className="italic text-disabled">{restriction}</span>)}
    </span>;
    const description: TsxElement | undefined = resolved?.description == undefined
        ? undefined
        : <p className="ml-4 my-0.5 font-sans text-disabled">{resolved.description}</p>;

    return (
        <div className={depth > 0 ? 'ml-4 pl-2 border-l border-dashed border-disabled-dark font-mono text-sm' : 'font-mono text-sm'}>
            {parts.length
                ? <details open={depth < 2}>
                    <summary className="cursor-pointer">{head}</summary>
                    {description}
                    {parts.map(([partName, part, partRequired]) => <ExplorerSchema
                        name={partName}
                        schema={part}
                        required={partRequired}
                        references={nextReferences}
                        depth={depth + 1}
                    />)}
                </details>
                : <div>
                    {head}
                    {description}
                </div>}
        </div>
    );
};
