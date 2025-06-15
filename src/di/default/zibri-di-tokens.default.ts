
// eslint-disable-next-line typescript/typedef
export const ZIBRI_DI_TOKENS = {
    ROUTER: 'zi.router',
    LOG_LEVEL: 'zi.log_level',
    LOGGER: 'zi.logger',
    ASSET_SERVICE: 'zi.asset_service',
    GLOBAL_ERROR_HANDLER: 'zi.global_error_handler',
    OPEN_API_SERVICE: 'zi.open_api_service',
    AUTH_SERVICE: 'zi.auth_service',
    PARSER: 'zi.parser_service',
    VALIDATION_SERVICE: 'zi.validation_service',
    DATA_SOURCE_SERVICE: 'zi.data_source_service',
    JWT_ACCESS_TOKEN_SECRET: 'zi.jwt_access_token_secret',
    JWT_ACCESS_TOKEN_EXPIRES_IN_MS: 'zi.jwt_access_token_expires_in_ms',
    JWT_REFRESH_TOKEN_SECRET: 'zi.jwt_refresh_token_secret',
    JWT_REFRESH_TOKEN_EXPIRES_IN_MS: 'zi.jwt_refresh_token_expires_in_ms',
    USER_SERVICE: 'zi.user_service',
    CRON_SERVICE: 'zi.cron_service'
} as const satisfies Record<string, `zi.${string}`>;