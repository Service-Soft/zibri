
export enum HttpStatus {
    // Success
    OK = 200,
    CREATED = 201,
    // Client Error
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND_ERROR = 404,
    // Server Error
    INTERNAL_SERVER_ERROR = 500
}