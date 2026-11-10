# Zibri TSX

The runtime of the `.tsx` page and email templates of [Zibri](https://github.com/Service-Soft/zibri)
applications, and of pages written in markdown, `.md` and `.mdx`. `zibri-tsx-compiler` compiles a template at build
time into a function that renders html on the server with this package.
The code a template runs in the browser carries only the props and declarations it reads, and an
import it would need is a compile error, so a secret the server holds cannot reach the page.

```bash
npm i zibri-tsx
npm i -D zibri-tsx-compiler
```

`zi new` installs it and sets up the build for you. A page is rendered from a controller:

```ts
import { Controller, Get, HtmlResponse, Response, TsxUtilities } from 'zibri';

import { HomePage } from '../templates/pages/home';

@Controller('/')
export class PageController {

    @Response.html()
    @Get()
    index(): HtmlResponse {
        return HtmlResponse.fromString(TsxUtilities.renderPage(HomePage, { appName: 'Tasks' }));
    }
}
```

The full documentation is at
[service-soft.github.io/zibri/templates/templating](https://service-soft.github.io/zibri/templates/templating/).
