
import { readFile } from 'fs/promises';

import { EntityGenerationProvider } from './entity-generation-provider.interface';
import { openApiToV3 } from './open-api-to-v3.function';
import { OpenApiDefinition } from '../../../open-api';

/**
 * An entity generation provider using a local open api file.
 */
export class OpenApiFileProvider implements EntityGenerationProvider {
    constructor(readonly prefix: string, protected readonly filePath: string, readonly markAsEntities: boolean = true) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSpec(): Promise<OpenApiDefinition> {
        const spec: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
        return await openApiToV3(spec);
    }
}