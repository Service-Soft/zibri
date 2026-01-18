import { OpenApiDefinition } from '../../../open-api';

/**
 * A provider for automatic entity generation.
 */
export interface EntityGenerationProvider {
    /**
     * The prefix to add to all generated entities, so that they don't overlap with any existing ones.
     */
    readonly prefix: string,
    /**
     * Whether or not the generated entities should be marked with @Entity.
     */
    readonly markAsEntities: boolean,
    /**
     * Whether or not to generate schemas from openapi paths.
     */
    readonly generateSchemasFromPaths: boolean,
    /**
     * The method that actually resolves the open api spec that is then later on used to generate the entities.
     */
    resolveSpec: () => Promise<OpenApiDefinition>
}