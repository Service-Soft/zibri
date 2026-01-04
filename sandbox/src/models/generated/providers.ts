import { EntityGenerationProvider, OpenApiUrlProvider } from 'zibri';

export const providers: EntityGenerationProvider[] = [new OpenApiUrlProvider('Petstore', 'https://petstore.swagger.io/v2/swagger.json', false)];