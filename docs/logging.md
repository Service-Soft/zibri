# Logging
The logging system in Zibri consists of:
- the logger itself
- one or multiple logger transports

A logger transport defines WHERE a logged message goes.
Zibri provides some by default, but you can of course create your own transports:
- console logger transport (prints the log to the console)
- db logger transport (saves a log entry in a data source)
- email logger transport (sends an email with the log to a specified email)

## Using the logger
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
        await this.logger.error('error message');
        await this.logger.critical('critical message');
    }
    // ...
}
```

## Configuring Logger Transports
You can configure the transports that should be used by adding them to your providers array:

```ts
// src/providers.ts
import { ZIBRI_DI_TOKENS, LoggerTransport, LogLevel } from 'zibri';

[ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS]: {
    useFactory: () => [
        LoggerTransport.console(LogLevel.INFO),
        LoggerTransport.db(LogLevel.INFO)
    ]
},
```

As you can see we provide a log level for each transport here. This is especially useful if you want to use something like the email transport, which should probably only activate for critical errors.