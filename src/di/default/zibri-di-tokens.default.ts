
/**
 * Injection Tokens used and provided by Zibri.
 */
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
    JWT_PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: 'zi.jwt_password_reset_token_expires_in_ms',
    JWT_CONFIRM_PASSWORD_RESET_URL: 'zi.jwt_confirm_password_reset_url',
    MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS: 'zi.mailing_list_subscription_confirmation_token_expires_in_ms',
    USER_SERVICE: 'zi.user_service',
    CRON_SERVICE: 'zi.cron_service',
    FILE_UPLOAD_TEMP_FOLDER: 'zi.file_upload_temp_folder',
    FORMAT_DATE: 'zi.format_date',
    EMAIL_SERVICE: 'zi.email_service',
    EMAIL_CONFIG: 'zi.email_config',
    MAILING_LIST_SERVICE: 'zi.mailing_list_service'
} as const satisfies Record<string, `zi.${string}`>;