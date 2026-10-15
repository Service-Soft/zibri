
import { getEntityFileName } from './get-entity-file-name.function';
import { EntityGenerationProvider } from './providers/entity-generation-provider.interface';
import { OpenApiReferenceObject, OpenApiSchemaObject, OpenApiSchemas } from '../../open-api/open-api.model';
import { addImportStatement } from '../../utilities/add-import-statement.function';
import { JsonUtilities } from '../../utilities/json.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { toPascalCase } from '../../utilities/to-pascal-case.function';
import { EntityTenant } from '../models/entity-tenant.model';

/**
 * The result for generating a single entity.
 */
export type GenerateEntityFileResult = {
    /**
     * Any additional found open api schemas.
     */
    foundSchemas: OpenApiSchemas,
    /**
     * The lines needed to generate the entity file.
     */
    lines: string[]
};

/**
 * The result of resolving a typescript type.
 */
type ResolveTsTypeResult = {
    /**
     * The actual type eg. 'string' | 'number'.
     */
    type: string,
    /**
     * Whether or not the type in open api is a reference.
     */
    isRef: boolean,
    /**
     * The open api schema of the type.
     */
    schema?: OpenApiSchemaObject | OpenApiReferenceObject
};

/**
 * Generates a single entity file.
 * @param provider - The provider from which the schema was resolved.
 * @param name - The name of the entity.
 * @param schema - The open api schema of the entity.
 * @returns Any additional schemas found and the lines needed to generate the entity file.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export function generateEntityFile(
    provider: EntityGenerationProvider,
    name: string,
    schema: OpenApiSchemaObject
): GenerateEntityFileResult {
    const properties: OpenApiSchemas = schema.properties ?? {};
    const required: Set<string> = new Set(schema.required ?? []);

    const lines: string[] = [];

    const tenant: false | EntityTenant = provider.markAsEntities;
    lines.push(`import { ${tenant === false ? '' : 'Entity, '}Property } from \'zibri\';`);
    lines.push('');
    if (tenant !== false) {
        lines.push(`@Entity(${resolveTenantOption(tenant)})`);
    }
    lines.push(`export class ${getEntityName(provider.prefix, name)} {`);
    const tenantProperty: string | undefined = tenant === false || tenant === 'shared' ? undefined : tenant.property;
    // a schema of another api knows nothing about the tenants of this one, so the property holding
    // the tenant is added when the schema does not bring it
    if (tenantProperty != undefined && !(tenantProperty in properties)) {
        lines.push('', '    @Property.string({ format: \'uuid\' })', `    '${tenantProperty}'!: string;`);
    }

    const foundSchemas: OpenApiSchemas = {};

    for (const [propName, propSchema] of ObjectUtilities.entries(properties)) {
        const isRequired: boolean = required.has(propName);
        const optional: string = isRequired ? '!' : '?';
        // every tenant id is a uuid, so one the schema brings is declared as one whatever format it names.
        // a tenant property of another type is left as the schema says, and @Entity refuses it when the app starts
        if (propName === tenantProperty && !('$ref' in propSchema) && propSchema.type === 'string') {
            const uuidOptions: string = isRequired ? '{ format: \'uuid\' }' : '{ required: false, format: \'uuid\' }';
            lines.push('', `    @Property.string(${uuidOptions})`, `    '${propName}'${optional}: string;`);
            continue;
        }
        const { type, isRef, schema } = mapSchemaToTsType(propSchema, propName);
        if (isRef && schema && !('$ref' in schema)) {
            // type could be "X" or "X[]"; normalize to base name
            const baseType: string = type.endsWith('[]') ? type.slice(0, -2) : type;
            // only add if not already present (will get processed by outer loop)
            if (!(baseType in foundSchemas)) {
                foundSchemas[baseType] = schema;
            }
        }
        const decoratorLines: string[] = mapSchemaToDecoratorLines(propSchema, propName, provider.prefix, isRequired, type);

        if (!isRef) {
            lines.push('', ...decoratorLines, `    '${propName}'${optional}: ${type};`);
            continue;
        }

        lines.push('', ...decoratorLines, `    '${propName}'${optional}: ${getEntityName(provider.prefix, type)};`);
        const itemType: string = type.split('[]')[0] ?? type;
        const entityFileName: string = getEntityFileName(provider.prefix, itemType);
        addImportStatement(
            lines,
            {
                defaultImport: false,
                element: getEntityName(provider.prefix, itemType),
                path: `./${entityFileName.split('.ts')[0] ?? entityFileName}`
            }
        );
    }

    lines.push('}');

    return { foundSchemas, lines };
}

// eslint-disable-next-line jsdoc/require-jsdoc
function mapSchemaToTsType(
    schema: OpenApiSchemaObject | OpenApiReferenceObject,
    propName: string
): ResolveTsTypeResult {
    if ('$ref' in schema) {
        return { type: schema.$ref?.split('/').pop() ?? '', isRef: true };
    }

    switch (schema.type) {
        case 'string': {
            if (schema.enum) {
                return { type: schema.enum.map(v => JsonUtilities.stringify(v).replaceAll('"', '\'')).join(' | '), isRef: false };
            }
            if (schema.format === 'date-time') {
                return { type: 'Date', isRef: false };
            }
            return { type: 'string', isRef: false };
        }
        case 'integer':
        case 'number': {
            return { type: 'number', isRef: false };
        }
        case 'boolean': {
            return { type: 'boolean', isRef: false };
        }
        case 'array': {
            if (!schema.items) {
                return {
                    type: 'unknown[]',
                    isRef: false
                };
            }
            const { type, isRef, schema: s } = mapSchemaToTsType(schema.items, `${propName}Item`);
            return { type: `${type}[]`, isRef, schema: s };
        }
        case 'object': {
            if (!schema.properties) {
                return { type: 'Record<string, unknown>', isRef: false };
            }
            return { type: schema.title ?? propName, isRef: true, schema: schema };
        }
        case undefined: {
            return { type: 'undefined', isRef: false };
        }
        case 'null': {
            return { type: 'null', isRef: false };
        }
        default: {
            return { type: 'unknown', isRef: false };
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
function mapSchemaToDecoratorLines(
    schema: OpenApiSchemaObject | OpenApiReferenceObject,
    propName: string,
    prefix: string,
    isRequired: boolean,
    type: string
): string[] {
    if ('$ref' in schema) {
        // eslint-disable-next-line sonar/no-duplicate-string
        return [`    @Property.object({ ${!isRequired ? 'required: false, ' : ''}cls: () => ${getEntityName(prefix, type)} })`];
    }

    switch (schema.type) {
        case 'string': {
            if (schema.format === 'date-time') {
                if (isRequired) {
                    return ['    @Property.date()'];
                }
                return ['    @Property.date({ required: false })'];
            }
            // TODO handle enums in entity generation
            // if (schema.enum) {
            //     return { type: schema.enum.map(v => JsonUtilities.stringify(v)).join(' | '), isRef: false };
            // }
            if (isRequired) {
                return ['    @Property.string()'];
            }
            return ['    @Property.string({ required: false })'];
        }
        case 'integer':
        case 'number': {
            if (isRequired) {
                return ['    @Property.number()'];
            }
            return ['    @Property.number({ required: false })'];
        }
        case 'boolean': {
            if (isRequired) {
                return ['    @Property.boolean()'];
            }
            return ['    @Property.boolean({ required: false })'];
        }
        case 'array': {
            if (!schema.items) {
                return [`    @Property.array({ ${!isRequired ? 'required: false, ' : ''}items: { type: 'unknown' } })`];
            }
            const { type: t, isRef } = mapSchemaToTsType(schema.items, propName);
            const itemsType: string = isRef ? `'object', cls: () => ${getEntityName(prefix, type.split('[]')[0] ?? type)}` : `'${t}'`;
            if (itemsType.startsWith('\'\'')) {
                return [`    @Property.array({ ${!isRequired ? 'required: false, ' : ''}items: { type: 'string' } })`];
            }
            if (itemsType === '\'Record<string, unknown>\'') {
                return [`    @Property.array({ ${!isRequired ? 'required: false, ' : ''}items: { type: 'unknown' } })`];
            }
            return [`    @Property.array({ ${!isRequired ? 'required: false, ' : ''}items: { type: ${itemsType} } })`];
        }
        case undefined:
        case 'null': {
            return [];
        }
        case 'object':
        default: {
            if (isRequired) {
                return ['    @Property.unknown()'];
            }
            return ['    @Property.unknown({ required: false })'];
        }
    }
}

/**
 * Writes the options of the generated entity decorator for the tenant it is given.
 * @param tenant - The tenant the generated entities belong to.
 * @returns The options, or nothing when the tenant is the one held in `tenantId` by default.
 */
function resolveTenantOption(tenant: EntityTenant): string {
    if (tenant === 'shared') {
        return '{ tenant: \'shared\' }';
    }
    return tenant.property === 'tenantId' ? '' : `{ tenant: { property: '${tenant.property}' } }`;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getEntityName(prefix: string, name: string): string {
    return `${toPascalCase(prefix)}${toPascalCase(name)}`.replaceAll('{', '').replaceAll('}', '');
}