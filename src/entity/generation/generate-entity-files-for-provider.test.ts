import assert from 'assert';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { FileToGenerate, generateEntityFilesForProvider } from './generate-entity-files-for-provider.function';
import { EntityGenerationProvider } from './providers/entity-generation-provider.interface';
import { OpenApiUrlProvider } from './providers/open-api-url.provider';
import { initDiContainer } from '../../di/init-di-container.function';
import { OpenApiDefinition } from '../../open-api/open-api.model';
import { toKebabCase } from '../../utilities/to-kebab-case.function';
import { toPascalCase } from '../../utilities/to-pascal-case.function';

// small InlineProvider so tests are offline and deterministic
class InlineProvider implements EntityGenerationProvider {
    constructor(readonly prefix: string, private readonly spec: OpenApiDefinition, readonly generateSchemasFromPaths: boolean = true, readonly markAsEntities: boolean = true) {}
    // eslint-disable-next-line typescript/require-await
    async resolveSpec(): Promise<OpenApiDefinition> {
        return this.spec;
    }
}

function findFile(files: FileToGenerate[], className: string): FileToGenerate | undefined {
    return files.find(f => f.lines.join('\n').includes(`export class ${className}`));
}

function expectDecoratorAboveProperty(
    fileContent: string,
    decoratorRegex: RegExp,
    propNameRegex: RegExp
): void {
    // Match a decorator block immediately followed by the property line.
    // Allows optional single blank line between decorator and property (be tolerant),
    // but not other property lines in between.
    const re: RegExp = new RegExp(
        `${decoratorRegex.source}\\s*\\r?\\n\\s*${propNameRegex.source}`,
        'm'
    );
    expect(re.test(fileContent)).toBe(true);
}

describe('generateEntityFiles', () => {
    beforeAll(() => {
        initDiContainer();
    });

    it('PetStore', async () => {
        const provider: OpenApiUrlProvider = new OpenApiUrlProvider('PetStore', 'https://petstore.swagger.io/v2/swagger.json');
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');
        const indexLines: string[] = filesToGenerate.find(f => f.path.endsWith('index.ts'))?.lines ?? [];

        const pascalPrefix: string = toPascalCase(provider.prefix);
        const kebabPrefix: string = toKebabCase(provider.prefix);

        const expectedSchemas: string[] = ['ApiResponse', 'Category', 'Pet', 'Tag', 'Order', 'User'];
        for (const schemaName of expectedSchemas) {
            const expectedClassName: string = `${pascalPrefix}${toPascalCase(schemaName)}`;
            const found: boolean = filesToGenerate.some(f => f.lines.join('\n').includes(`export class ${expectedClassName}`));
            expect(found).toBe(true);

            const expectedExportFragment: string = `${kebabPrefix}.${toKebabCase(schemaName)}.model`;
            const indexFound: boolean = indexLines.some(l => l.includes(expectedExportFragment));
            expect(indexFound).toBe(true);
        }

        // In-depth checks for Pet entity
        const petClassName: string = `${pascalPrefix}Pet`;
        const petFile: FileToGenerate | undefined = filesToGenerate.find(f => f.lines.join('\n').includes(`export class ${petClassName}`));
        expect(petFile).toBeDefined();

        assert(petFile);

        const petContent: string = petFile.lines.join('\n');

        // required fields should be marked (e.g. name! and photoUrls!)
        expect(petContent).toContain('\'name\'!:');
        expect(petContent).toContain('\'photoUrls\'!:');

        // status enum should be present (contains one of the enum values)
        expect(petContent).toMatch(/available|pending|sold/);

        // imports for related inline entities should be present (Category, Tag)
        const catClass: string = `${pascalPrefix}Category`;
        const tagClass: string = `${pascalPrefix}Tag`;
        expect(petContent).toContain(catClass);
        expect(petContent).toContain(tagClass);

        // indexLines should contain at least the pet export
        const petExport: string = `${kebabPrefix}.pet.model`;
        expect(indexLines.some(l => l.includes(petExport))).toBe(true);
    });

    it('string (required/optional) and date-time produce correct decorators', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'test', version: '1.0' },
            components: {
                schemas: {
                    Thing: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            note: { type: 'string' },
                            created: { type: 'string', format: 'date-time' }
                        },
                        required: ['name', 'created']
                    }
                }
            },
            paths: {}
        };

        const provider: InlineProvider = new InlineProvider('TestSvc', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');

        const className: string = `${toPascalCase(provider.prefix)}${toPascalCase('Thing')}`;
        const file: FileToGenerate | undefined = findFile(filesToGenerate, className);
        expect(file).toBeDefined();
        assert(file);
        const content: string = file.lines.join('\n');

        // name is required -> should have '!' and @Property.string() immediately above
        expect(content).toContain('\'name\'!:');
        expectDecoratorAboveProperty(content, /@Property\.string\(\)/, /'name'!:/);

        // note is optional -> @Property.string({ required: false }) must be right above `note?:`
        expect(content).toMatch('\'note\'?:');
        expectDecoratorAboveProperty(content, /@Property\.string\({\s*required:\s*false\s*}\)/, /'note'\?:/);

        // created -> date decorator right above created property
        expectDecoratorAboveProperty(content, /@Property\.date\(\)/, /'created'!:/);
    });

    it('number/integer and boolean map to @Property.number/@Property.boolean', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'NumBool', version: '1.0' },
            components: {
                schemas: {
                    Metrics: {
                        type: 'object',
                        properties: {
                            count: { type: 'integer', format: 'int32' },
                            ratio: { type: 'number' },
                            flag: { type: 'boolean' }
                        },
                        required: ['count', 'flag']
                    }
                }
            },
            paths: {}
        };

        const provider: InlineProvider = new InlineProvider('NumBool', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');

        const className: string = `${toPascalCase(provider.prefix)}${toPascalCase('Metrics')}`;
        const file: FileToGenerate | undefined = findFile(filesToGenerate, className);
        expect(file).toBeDefined();
        assert(file);
        const content: string = file.lines.join('\n');

        // count required -> number decorator + '!'
        expect(content).toContain('\'count\'!:');
        expectDecoratorAboveProperty(content, /@Property\.number\(\)/, /'count'!:/);

        // ratio optional -> number decorator with required:false immediately above ratio property
        expect(content).toContain('\'ratio\'?:');
        expectDecoratorAboveProperty(content, /@Property\.number\({\s*required:\s*false\s*}\)/, /'ratio'\?:/);

        // flag required -> boolean decorator + '!'
        expect(content).toContain('\'flag\'!:');
        expectDecoratorAboveProperty(content, /@Property\.boolean\(\)/, /'flag'!:/);
    });

    it('array of primitives uses @Property.array with item type', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'arrays', version: '1.0' },
            components: {
                schemas: {
                    Bag: {
                        type: 'object',
                        properties: {
                            tags: { type: 'array', items: { type: 'string' } },
                            counts: { type: 'array', items: { type: 'integer' } }
                        },
                        required: ['tags']
                    }
                }
            },
            paths: {}
        };

        const provider: InlineProvider = new InlineProvider('BagSvc', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');

        const className: string = `${toPascalCase(provider.prefix)}${toPascalCase('Bag')}`;
        const file: FileToGenerate | undefined = findFile(filesToGenerate, className);
        expect(file).toBeDefined();
        assert(file);
        const content: string = file.lines.join('\n');

        // tags required => property signature with ! and decorator items: { type: 'string' }
        expect(content).toContain('\'tags\'!:');
        expectDecoratorAboveProperty(content, /@Property\.array\([^)]*items:\s*{\s*type:\s*'string'\s*}[^)]*\)/, /'tags'!:/);

        // counts optional => items type integer -> mapped to 'number' in decorator and required:false
        expect(content).toContain('\'counts\'?:');
        expectDecoratorAboveProperty(content, /@Property\.array\([^)]*required:\s*false[^)]*items:\s*{\s*type:\s*'number'\s*}[^)]*\)/, /'counts'\?:/);
    });

    it('array of inline objects uses schema.title for generated name and preserves property metadata', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'inline-arr-rich', version: '1.0' },
            components: {
                schemas: {
                    Container: {
                        type: 'object',
                        properties: {
                            parts: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    title: 'CustomPart', // important: generator should use this title
                                    description: 'A detailed part object',
                                    properties: {
                                        id: { type: 'string', description: 'identifier' },
                                        amount: { type: 'integer', format: 'int32' },
                                        status: { type: 'string', enum: ['ok', 'bad'] },
                                        createdAt: { type: 'string', format: 'date-time' }
                                    },
                                    required: ['id', 'createdAt']
                                }
                            }
                        },
                        required: ['parts']
                    }
                }
            },
            paths: {}
        };

        const provider: InlineProvider = new InlineProvider('InlineSvc', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');
        const indexLines: string[] = filesToGenerate.find(f => f.path.endsWith('index.ts'))?.lines ?? [];

        // expected names: prefix + title
        const parentClass: string = `${toPascalCase(provider.prefix)}Container`;
        const childClass: string = `${toPascalCase(provider.prefix)}CustomPart`; // must use schema.title, not prop name

        const parentFile: FileToGenerate | undefined = findFile(filesToGenerate, parentClass);
        const childFile: FileToGenerate | undefined = findFile(filesToGenerate, childClass);

        expect(parentFile).toBeDefined();
        expect(childFile).toBeDefined();

        assert(parentFile);
        assert(childFile);

        const parentContent: string = parentFile.lines.join('\n');
        const childContent: string = childFile.lines.join('\n');

        // parent should reference child type in property signature
        expect(parentContent).toContain(`'parts'!: ${childClass}`);
        // parent decorator must reference cls: () => ChildClass directly above parts
        expectDecoratorAboveProperty(
            parentContent,
            new RegExp(`@Property\\.array\\([^)]*type:\\s*'object'[^)]*cls:\\s*\\(\\)\\s*=>\\s*${childClass}[^)]*\\)`),
            /'parts'!:/
        );

        // parent file should import the child (simple presence of the child class name in imports)
        const importLinePresent: boolean = parentFile.lines.some(l => l.includes('import') && l.includes(childClass));
        expect(importLinePresent).toBe(true);

        // child file: check class name and decorator placement for required fields
        expect(childContent).toContain(`export class ${childClass}`);
        expect(childContent).toContain('\'id\'!:'); // required id
        expectDecoratorAboveProperty(childContent, /@Property\.string\(\)/, /'id'!:/);

        // createdAt uses date-time -> date decorator and required
        expect(childContent).toContain('\'createdAt\'!:');
        expectDecoratorAboveProperty(childContent, /@Property\.date\(\)/, /'createdAt'!:/);

        // amount mapped to number decorator
        expectDecoratorAboveProperty(childContent, /@Property\.number\({\s*required:\s*false\s*}\)/, /'amount'\?:/);

        // enum values should appear in the generated type (or decorator metadata)
        expect(childContent).toMatch(/'ok'\s*|\s*'bad'/);

        // index should export both files (kebab-case fragment)
        const kebabPrefix: string = toKebabCase(provider.prefix);
        expect(indexLines.some(l => l.includes(`${kebabPrefix}.container.model`))).toBe(true);
        expect(indexLines.some(l => l.includes(`${kebabPrefix}.custom-part.model`))).toBe(true);
    });

    it('property referencing a components schema ($ref) produces object decorator and import', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'ref-test', version: '1.0' },
            components: {
                schemas: {
                    Refed: {
                        type: 'object',
                        properties: { a: { type: 'string' } },
                        required: ['a']
                    },
                    Host: {
                        type: 'object',
                        properties: {
                            other: { $ref: '#/components/schemas/Refed' }
                        },
                        required: ['other']
                    }
                }
            },
            paths: {}
        };

        const provider: InlineProvider = new InlineProvider('RefSvc', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');
        const indexLines: string[] = filesToGenerate.find(f => f.path.endsWith('index.ts'))?.lines ?? [];

        const hostClass: string = `${toPascalCase(provider.prefix)}${toPascalCase('Host')}`;
        const refedClass: string = `${toPascalCase(provider.prefix)}${toPascalCase('Refed')}`;

        const hostFile: FileToGenerate | undefined = findFile(filesToGenerate, hostClass);
        const refedFile: FileToGenerate | undefined = findFile(filesToGenerate, refedClass);

        expect(hostFile).toBeDefined();
        expect(refedFile).toBeDefined();
        assert(hostFile);
        assert(refedFile);

        const hostContent: string = hostFile.lines.join('\n');

        // decorator should reference the refed class directly above the property
        expectDecoratorAboveProperty(
            hostContent,
            new RegExp(`@Property\\.object\\([^)]*cls:\\s*\\(\\)\\s*=>\\s*${refedClass}[^)]*\\)`),
            /'other'!:/
        );

        // host property should be typed to the referenced class
        expect(hostContent).toContain(`'other'!: ${refedClass}`);

        // import line for the refed class should be present
        const importLinePresent: boolean = hostFile.lines.some(l => l.includes('import') && l.includes(refedClass));
        expect(importLinePresent).toBe(true);

        // index exports should include both files
        const kebabPrefix: string = toKebabCase(provider.prefix);
        expect(indexLines.some(l => l.includes(`${kebabPrefix}.host.model`))).toBe(true);
        expect(indexLines.some(l => l.includes(`${kebabPrefix}.refed.model`))).toBe(true);
    });

    it('generates entities from requestBody schemas (inline)', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'request-body-entities', version: '1.0' },
            paths: {
                '/users': {
                    post: {
                        operationId: 'createUser',
                        requestBody: {
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        title: 'CreateUserPayload', // generator should prefer this title
                                        properties: {
                                            id: { type: 'integer', format: 'int64' },
                                            date: { type: 'string', format: 'date-time' },
                                            role: { type: 'string', enum: ['admin', 'user'] }
                                        },
                                        required: ['id', 'date']
                                    }
                                }
                            }
                        },
                        responses: {
                            200: { description: 'ok' }
                        }
                    }
                }
            },
            components: { schemas: {} }
        };

        const provider: InlineProvider = new InlineProvider('Api', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');
        const indexLines: string[] = filesToGenerate.find(f => f.path.endsWith('index.ts'))?.lines ?? [];

        const childClass: string = `${toPascalCase(provider.prefix)}CreateUserPayload`;
        const childFile: FileToGenerate | undefined = findFile(filesToGenerate, childClass);
        expect(childFile).toBeDefined();
        assert(childFile);

        const content: string = childFile.lines.join('\n');

        // class name and required markers
        expect(content).toContain(`export class ${childClass}`);
        expect(content).toContain('\'id\'!:'); // id required
        expectDecoratorAboveProperty(content, /@Property\.number\(\)/, /'id'!:/);

        // date required -> date decorator
        expect(content).toContain('\'date\'!:');
        expectDecoratorAboveProperty(content, /@Property\.date\(\)/, /'date'!:/);

        // role optional -> union literal present and decorator above property (optional)
        expect(content).toMatch(/'admin'\s*\|\s*'user'/);
        expect(content).toContain('\'role\'?:');
        expectDecoratorAboveProperty(content, /@Property\.string\({\s*required:\s*false\s*}\)/, /'role'\?:/);

        // index export present (kebab-case)
        const kebabPrefix: string = toKebabCase(provider.prefix);
        expect(indexLines.some(l => l.includes(`${kebabPrefix}.create-user-payload.model`))).toBe(true);
    });

    it('generates entities from response schemas (inline)', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'responses-entities', version: '1.0' },
            paths: {
                '/pets/{id}': {
                    get: {
                        operationId: 'getPet',
                        responses: {
                            200: {
                                description: 'successful response',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            title: 'PetResponse', // generator should prefer this title
                                            properties: {
                                                id: { type: 'integer', format: 'int64' },
                                                name: { type: 'string' },
                                                status: { type: 'string', enum: ['available', 'pending', 'sold'] }
                                            },
                                            required: ['id', 'name']
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            components: { schemas: {} }
        };

        const provider: InlineProvider = new InlineProvider('Api', spec);
        const { filesToGenerate } = await generateEntityFilesForProvider(provider, 'test');
        const indexLines: string[] = filesToGenerate.find(f => f.path.endsWith('index.ts'))?.lines ?? [];

        const childClass: string = `${toPascalCase(provider.prefix)}PetResponse`;
        const childFile: FileToGenerate | undefined = findFile(filesToGenerate, childClass);
        expect(childFile).toBeDefined();
        assert(childFile);

        const content: string = childFile.lines.join('\n');

        // class name and required markers
        expect(content).toContain(`export class ${childClass}`);
        expect(content).toContain('\'id\'!:');
        expectDecoratorAboveProperty(content, /@Property\.number\(\)/, /'id'!:/);

        // name required -> string decorator
        expect(content).toContain('\'name\'!:');
        expectDecoratorAboveProperty(content, /@Property\.string\(\)/, /'name'!:/);

        // status enum optional -> union literal present and decorator above property (optional)
        expect(content).toMatch(/'available'\s*\|\s*'pending'\s*\|\s*'sold'/);
        expect(content).toContain('\'status\'?:');
        expectDecoratorAboveProperty(content, /@Property\.string\({\s*required:\s*false\s*}\)/, /'status'\?:/);

        // index export present (kebab-case)
        const kebabPrefix: string = toKebabCase(provider.prefix);
        expect(indexLines.some(l => l.includes(`${kebabPrefix}.pet-response.model`))).toBe(true);
    });

});