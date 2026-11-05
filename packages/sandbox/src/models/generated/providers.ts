import { EntityGenerationProvider, OpenApiUrlProvider } from 'zibri';

export const providers: EntityGenerationProvider[] = [new OpenApiUrlProvider({ prefix: 'Petstore', baseUrl: 'https://petstore.swagger.io/v2/swagger.json', onError: 'warn' })];