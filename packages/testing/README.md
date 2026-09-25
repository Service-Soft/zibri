# Zibri Testing

The test harness for [Zibri](https://github.com/Service-Soft/zibri) applications. It starts your
application — the router, the auth strategies, the lifecycle and the data source that ship — and
hands a test the url to drive it at.

```bash
npm i -D zibri-testing
```

```ts
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';

const server: StartedTestServer = await startTestServer({ application: testApplicationOptions });
const baseUrl: string = await server.start();

const response: Response = await fetch(baseUrl);
```

`zi new` sets this up for you, including a first test to copy.

The full documentation is at
[service-soft.github.io/zibri/documents/testing](https://service-soft.github.io/zibri/documents/testing.html).