
// eslint-disable-next-line typescript/typedef
export const ZIBRI_DI_TOKENS = {
    ROUTER: 'cx.router',
    LOG_LEVEL: 'cx.log_level',
    LOGGER: 'cx.logger',
    ASSET_SERVICE: 'cx.asset_service',
    GLOBAL_ERROR_HANDLER: 'cx.global_error_handler',
    OPEN_API_SERVICE: 'cx.open_api_service',
    PARSER: 'cx.parser_service',
    VALIDATION_SERVICE: 'cx.validation_service'
} as const satisfies Record<string, `cx.${string}`>;