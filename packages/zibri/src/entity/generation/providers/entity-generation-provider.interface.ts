import { OpenApiDefinition } from '../../../open-api/open-api.model.ts';
import { EntityTenant } from '../../models/entity-tenant.model.ts';

/**
 * A provider for automatic entity generation.
 */
export interface EntityGenerationProvider {
    /**
     * The prefix to add to all generated entities, so that they don't overlap with any existing ones.
     */
    readonly prefix: string,
    /**
     * Whether the generated classes are marked with @Entity, and which tenant their rows belong to.
     *
     * `false` generates plain classes. `'shared'` marks them as entities every tenant shares, and
     * `{ property: 'tenantId' }` as entities of one tenant each. That property is a uuid string: it is
     * generated when the schema does not have it, and declared as a uuid when the schema has it as a string.
     */
    readonly markAsEntities: false | EntityTenant,
    /**
     * Whether or not to generate schemas from openapi paths.
     */
    readonly generateSchemasFromPaths: boolean,
    /**
     * Whether to throw or warn when the provider could not resolve the open api definition.
     */
    readonly onError: 'throw' | 'warn',
    /**
     * The method that actually resolves the open api spec that is then later on used to generate the entities.
     */
    resolveSpec: () => Promise<OpenApiDefinition>
}