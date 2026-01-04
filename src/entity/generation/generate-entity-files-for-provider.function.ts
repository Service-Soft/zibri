import { mkdir } from 'fs/promises';
import path from 'path';

import { generateEntityFile } from './generate-entity-file.function';
import { getEntityFileName } from './get-entity-file-name.function';
import { EntityGenerationProvider } from './providers';
import { warn } from '../../logging/logger.helpers';
import { OpenApiDefinition, OpenApiOperation, OpenApiReferenceObject, OpenApiResponseObject, OpenApiSchemaObject, OpenApiSchemas } from '../../open-api';
import { pathExists, toKebabCase, toPascalCase } from '../../utilities';

/**
 * All data needed to generate a file.
 */
export type FileToGenerate = {
    /**
     * The path where the file should be generated.
     */
    path: string,
    /**
     * The actual content of the file in lines.
     */
    lines: string[]
};

/**
 * All data needed to generate files for a provider and updating the index.ts.
 */
export type GenerateEntityFilesForProviderResult = {
    /**
     * The files to generate.
     */
    filesToGenerate: FileToGenerate[],
    /**
     * The lines to add to the index.ts.
     */
    indexLines: string[]
};

// eslint-disable-next-line typescript/typedef
const OP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/**
 * Generates entity files for the given provider.
 * @param provider - The provider to generate the files for.
 * @param cwd - The current working directory.
 * @returns The files to generate and the lines to add to the index.ts.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export async function generateEntityFilesForProvider(
    provider: EntityGenerationProvider,
    cwd: string
): Promise<GenerateEntityFilesForProviderResult> {
    const definition: OpenApiDefinition = await provider.resolveSpec();
    const schemas: OpenApiSchemas = definition.components?.schemas ?? {};
    // TODO
    for (const [key, path] of Object.entries(definition.paths ?? {})) {
        for (const method of OP_METHODS) {
            const operation: OpenApiOperation | undefined = path[method];
            if (!operation) {
                continue;
            }

            const baseFromOp: string = operation.operationId ?? toPascalCase(key);

            if (operation.requestBody && !('$ref' in operation.requestBody)) {
                for (const media of Object.values(operation.requestBody.content ?? {})) {
                    if (!media.schema) {
                        continue;
                    }
                    collectSchemaCandidate(media.schema, baseFromOp, schemas);
                }
            }

            for (const value of Object.values(operation.responses ?? {})) {
                // eslint-disable-next-line typescript/no-unsafe-assignment
                const response: OpenApiResponseObject | OpenApiReferenceObject | undefined = value;
                if (response == undefined) {
                    continue;
                }
                if ('$ref' in response) {
                    // ignore response $ref (could point to components.responses); responses often wrap schemas inside content
                    continue;
                }
                for (const media of Object.values(response.content ?? {})) {
                    if (!media.schema) {
                        continue;
                    }
                    // build name hint using status code if available in parent loop? we only have the schema and baseFromOp
                    collectSchemaCandidate(media.schema, baseFromOp, schemas);
                }
            }
        }
    }

    if (Object.keys(schemas).length === 0) {
        warn(`Could not find any schemas on spec for provider with prefix "${provider.prefix}"`);
        return {
            filesToGenerate: [],
            indexLines: []
        };
    }

    const filesToGenerate: FileToGenerate[] = [];
    const indexLines: string[] = [];

    const processedSchemas: Set<string> = new Set<string>();
    let foundSchemas: OpenApiSchemas = schemas;

    while (Object.keys(foundSchemas).length) {
        const entries: [string, OpenApiSchemaObject | OpenApiReferenceObject][] = Object.entries(foundSchemas);
        const nextFoundSchemas: OpenApiSchemas = {};
        for (const [key, value] of entries) {
            // skip if we already generated this schema earlier
            if (processedSchemas.has(key)) {
                continue;
            }
            if (!('type' in value) || value.type !== 'object') {
                processedSchemas.add(key);
                continue;
            }
            const fileName: string = getEntityFileName(provider.prefix, key);

            // eslint-disable-next-line sonar/no-duplicate-string
            const filePath: string = path.join(cwd, 'src/models/generated', toKebabCase(provider.prefix), fileName);
            if (await pathExists(filePath)) {
                processedSchemas.add(key);
                continue;
            }

            // eslint-disable-next-line typescript/typedef
            const generatedData = generateEntityFile(provider, key, value);

            // accumulate any inline schemas discovered while generating this file
            for (const inlineKey of Object.keys(generatedData.foundSchemas)) {
                if (!processedSchemas.has(inlineKey) && !(inlineKey in nextFoundSchemas)) {
                    nextFoundSchemas[inlineKey] = generatedData.foundSchemas[inlineKey];
                }
            }

            // mark this one as processed and queue the file write
            processedSchemas.add(key);
            filesToGenerate.push({ path: filePath, lines: generatedData.lines });
            indexLines.push(`export * from './${fileName.split('.ts')[0]}';`);
        }

        foundSchemas = nextFoundSchemas;
    }

    if (!filesToGenerate.length) {
        return {
            filesToGenerate,
            indexLines: []
        };
    }

    await mkdir(path.join(cwd, 'src/models/generated', toKebabCase(provider.prefix)), { recursive: true });
    filesToGenerate.push({ path: path.join(cwd, 'src/models/generated', toKebabCase(provider.prefix), 'index.ts'), lines: indexLines });

    return {
        filesToGenerate,
        indexLines: [`export * from './${toKebabCase(provider.prefix)}';`]
    };
}

// eslint-disable-next-line jsdoc/require-jsdoc
function collectSchemaCandidate(
    schema: OpenApiSchemaObject | OpenApiReferenceObject,
    nameHint: string,
    globalSchemas: OpenApiSchemas
): void {
    if ('$ref' in schema) {
        return;
    }

    // if primitive / non-object, ignore
    if (schema.type !== 'object' && schema.type !== 'array') {
        return;
    }

    // arrays: examine items
    if (schema.type === 'array' && schema.items) {
        collectSchemaCandidate(schema.items, schema.title ?? `${toPascalCase(nameHint)}Item`, globalSchemas);
        return;
    }

    // inline object with properties -> register under a deterministic name
    if ((!schema.type || schema.type === 'object') && schema.properties) {
        const name: string = schema.title ?? toPascalCase(nameHint);
        // don't override existing component definitions (prefer original)
        if (!(name in globalSchemas)) {
            globalSchemas[name] = schema;
        }
    }
}