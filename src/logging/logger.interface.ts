
export interface LoggerInterface {
    debug: (...messages: (string | number)[]) => void,
    info: (...messages: (string | number)[]) => void,
    warn: (...messages: (string | number)[]) => void,
    error: (...messages: (string | number | Error)[]) => void,
    critical: (...messages: (string | number | Error)[]) => void
}