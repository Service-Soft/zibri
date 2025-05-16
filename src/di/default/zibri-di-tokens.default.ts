
// eslint-disable-next-line typescript/typedef
export const ZIBRI_DI_TOKENS = {
    ROUTER: 'zi.router',
    LOG_LEVEL: 'zi.log_level',
    LOGGER: 'zi.logger',
    ASSET_SERVICE: 'zi.asset_service',
    GLOBAL_ERROR_HANDLER: 'zi.global_error_handler',
    OPEN_API_SERVICE: 'zi.open_api_service',
    PARSER: 'zi.parser_service',
    VALIDATION_SERVICE: 'zi.validation_service',
    DATA_SOURCE_SERVICE: 'zi.data_source_service'
} as const satisfies Record<string, `zi.${string}`>;