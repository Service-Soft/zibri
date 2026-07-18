# Logging
The logging system in Zibri consists of the logger itself and one or multiple logger transports.

A logger transport defines WHERE a logged message goes.
Zibri provides some by default, but you can of course create your own transports:
- console logger transport (prints the log to the console)
- db logger transport (saves a log entry in a data source)
- email logger transport (sends an email with the log to a specified email)

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `LoggerInterface` | interface | Log at `debug`/`info`/`warn`/`error`/`critical` levels |
| `ZIBRI_DI_TOKENS.LOGGER` | DI token | Injects `LoggerInterface` |
| `LoggerTransport` | class | Builder for a logger transport (eg. `.console()`, `.db()`) |
| `LogLevel` | enum | Minimum level a transport should log at |
| `ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS` | DI token | Overrides the transports used by the logger |

## Usage
### Using the logger
You can inject the logger by its token:

```ts
// src/controllers/test.controller.ts
import { Controller, inject, Inject, LoggerInterface, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/tests')
export class TestController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {
        const alternative: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async logStuff(): Promise<void> {
        await this.logger.debug('debug message');
        await this.logger.info('info message');
        await this.logger.warn('warn message');
        await this.logger.error(new Error('error message'));
        await this.logger.critical(new Error('critical message'));
    }
    // ...
}
```

## Configuration
You can configure the transports that should be used by adding them to your providers array:

```ts
// src/providers.ts
import { ZIBRI_DI_TOKENS, LoggerTransport, LogLevel } from 'zibri';


defineProvider({
    token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS,
    useFactory: () => [
        LoggerTransport.console(LogLevel.INFO),
        LoggerTransport.db(LogLevel.INFO)
    ]
}),
```

As you can see we provide a log level for each transport here. This is especially useful if you want to use something like the email transport, which should probably only activate for critical errors.

## See also
- [Dependency injection](./di.md) — the providers array used to override `LOGGER_TRANSPORTS`
- [Error handling](./error-handling.md) — `error`/`critical` take an `Error` instance
- [Request context](./request-context.md) — request/cache info attached to log lines
