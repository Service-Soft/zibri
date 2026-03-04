# Dependency Injection
The Dependency Injection system is one of the most fundamental building blocks of Zibri.

## Adding new injectables
To make something injectable there are 2 ways:
1. decorate a class with `@Injectable()`
2. add the value to your providers array

In most cases, you will probably just have to decorate a class:

### With @Injectable
```ts
// src/services/test.service.ts
import { Injectable } from 'zibri';

@Injectable()
export class TestService {
    // ...
}
```

Now you can easily inject the TestService either by adding it to a constructor or by using the `inject` helper:

```ts
// src/controllers/test.controller.ts
import { Controller, inject } from 'zibri';

import { TestService } from '../services';

@Controller('/tests')
export class TestController {
    constructor(private readonly testService: TestService) {
        const alternative: TestService = inject(TestService);
    }
    // ...
}
```

### With the providers array
Alternatively, you can also add them to the providers array:

```ts
// src/providers.ts
import { DiProvider, defineProvider, InjectionToken, ZIBRI_DI_TOKENS } from 'zibri';

export const someToken = new InjectionToken<string>('some-token');

export const providers: DiProvider<unknown>[] = [
    // ...
    defineProvider({
        token: someToken,
        useFactory: () => '42'
    })
    // ...
]
```

And then inject them the same way before, with the constructor approach needing an additional decorator:

```ts
// src/controllers/test.controller.ts
import { Controller, inject } from 'zibri';
import { someToken } from '../../providers.ts';

@Controller('/tests')
export class TestController {
    constructor(
        @Inject(someToken)
        private readonly value: string
    ) {
        const alternative: string = inject(someToken);
    }
    // ...
}
```

## Overriding existing injectables
Bascially every service/functionality of the framework is registered for dependency injection. That makes it really easy for you to replace something with your own implementation if you need more functionality than the builtin solutions.

Let's say that you want for example to replace the default error handler with the following one:

```ts
// src/my-error-handler.ts
import { NextFunction } from 'express';
import { GlobalErrorHandler, HttpRequest, HttpResponse } from 'zibri';

export const myErrorHandler: GlobalErrorHandler = async (error: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => {
    // ...your custom logic
}
```

For that you can simply add it to your providers array:

```ts
// src/providers.ts
import { DiProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { myErrorHandler } from './my-error-handler.ts';

export const providers: DiProvider<unknown>[] = [
    // ...
    defineProvider({
        token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
        useFactory: () => myErrorHandler
    })
    // ...
]
```

That's it! From now on, your custom error handler will be used instead of the default one provided by Zibri.