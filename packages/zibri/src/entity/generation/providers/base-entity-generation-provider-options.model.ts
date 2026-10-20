import { EntityGenerationProvider } from './entity-generation-provider.interface.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';

/**
 * Options shared by every entity generation provider.
 */
export type BaseEntityGenerationProviderOptions = Partial<OmitStrict<EntityGenerationProvider, 'resolveSpec'>>
    & Pick<EntityGenerationProvider, 'prefix'>;