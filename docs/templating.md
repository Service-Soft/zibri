# Templating
The templating approach in Zibri currently differs based on whether you want to send an email or a html page.

# Emails
For emails, Zibri uses handlebars:

```ts
import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderPasswordResetTemplate from '../templates/emails/password-reset.hbs';
// ...
const content: string = renderPasswordResetTemplate({
    confirmPasswordResetUrl: 'http://localhost:4200/confirm-password-reset',
    resetToken: 'test-token',
    user: { name: 'James Smith' }
});
const html: string = renderBaseEmail({
    content,
    base: {
        title: 'Password Reset',
        baseUrl: 'http://localhost:3000'
    }
});
// ...
```

You might be wondering how we can import a ts function from a file ending with `.hbs`.

That's due to our handlebars compiler that automatically creates ts definitions based on your templates. It is actually smart enough to detect any variables that you use in your templates, as well as infer their type. While being extremly helpful, this type safety comes with the downside that any variables you use are restricted in their typing for the compiler to infer their type. They need to be either:
- string
- string[]
- an object with its values being either string, string[] or another object

These are also hot reloaded when you change your templates and eg. introduce or remove a new variable.  

> Caveat:<br>
> If you don't run `npm run start` then the compiler won't be able to generate the .ts files. So if you have any problems with eg. a property of your template not being recognized, check that first.

# Pages
For simple html pages Zibri uses [preact](https://preactjs.com/), but with some [heavy modifications](#additional-functionality).

This system is pretty great for a server side framework to render some basic pages. If you have more advanced use cases you should however you will probably be better of by creating a separate client application that consumes the Zibri API.

```ts
import { Controller, Get, GlobalRegistry, HtmlResponse, PreactUtilities, Response } from 'zibri';

import { HomePage } from '../templates/pages/home';

@Controller('/')
export class PageController {

    @Response.html()
    @Get()
    async index(): Promise<HtmlResponse> {
        return await PreactUtilities.renderResponse(HomePage, { appName: GlobalRegistry.getAppData('name') ?? '' });
    }
}
```

And here the HomePage component definition:

```tsx
import { PreactComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import { Card } from '../components/card';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

type Props = {
    appName: string
};

export const HomePage: PreactComponent<Props> = ({ appName }) => {
    return (
        <BasePage title='' activeRoute='/' className="flex flex-col gap-4 py-8">
            <Heading className="text-center">{appName}</Heading>
            <div className="max-w-fit mx-auto grid grid-cols-2 gap-4">
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/assets" icon="/assets/assets.svg">
                        Assets
                    </Link>
                    <p>
                        Lists all publicly registered assets.
                    </p>
                </Card>
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/explorer" icon="/assets/open-api/swagger.png">
                        OpenAPI Explorer
                    </Link>
                    <p>
                        The official OpenAPI/Swagger documentation.
                    </p>
                </Card>
                {/* <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/metrics/dashboard" icon="/assets/metrics.svg">
                        Metrics
                    </Link>
                    <p>
                        A basic metrics dashboard.
                    </p>
                </Card> */}
            </div>
        </BasePage>
    );
};
```

## Additional functionality
In addition to the features coming from preact out of the box, Zibri provides some more:

It tries to include js script tags inside the server generated code so that functionality can be restored on the frontend part.

Note that this is NOT hydration and only properties explicitly passed into a component can appear on the html/script sent to the client.
NO imports are resolved automatically.

This means that you can't simply leak server side secrets like api keys to the client just because you used `environment.apiUrl` somewhere and the `index.ts` where its imported from also contains some secrets that tsx compiles into the code. (A reoccuring problem with frameworks that mix the line between front- and backend)

But this also means that the functionality is a lot more restrictive than React, because every hook has to be custom provided. There are currently only two hooks available: `onClient` and `onServer`. Everything else that you might know (useState etc.) simply won't work.

Let's take the metrics page as an example (full content down below), because we have a lot of client functionality that gets restored.
The first thing you will probably notice is the strange import at the start of the file:

```tsx
import { Chart } from 'chart.js?client';
```

This is basically our way to tell the templating engine "chart.js needs to be available on the client side.".
What this results in is that a js file is automatically generated in `assets/public/vendor/chart.js.js` and then later referenced in the rendered html as a script tag.
This also has the added benefit that the version of chart.js on the client side is always the same as the one on the server side.

If you want to use a package on the client side, you also have to add an entry to the `tsx.d.ts`.

Let's go to the component body next:

```tsx
// ...
// the below can be safely executed on both server and client side.
Chart.defaults.color = 'whitesmoke';
Chart.defaults.borderColor = 'whitesmoke';
Chart.defaults.scale.grid.color = 'rgba(200, 200, 200, 0.3)';

let snaps: MetricsSnapshot[] = [];
let automaticReload: boolean = true;

// the onClient hook provides a way to mark logic that should only be called on the client.
// In this case window would throw an error on the server side, because it does not exist there.
onClient(() => {
    window.addEventListener('load', () => {
        void loadSnapshots();
        setInterval(() => void loadSnapshots(), 1000);
    });
});

async function loadSnapshots(): Promise<void> {
    if (!automaticReload) {
        return;
    }
    try {
        const resp: Response = await fetch('/metrics');
        snaps = await resp.json();
        document.dispatchEvent(new CustomEvent('metrics:update', { detail: { snaps } }));
    }
    catch (error) {
        console.error('failed to load metrics', error);
    }
}
//...
```

Finally let's take a look at the template returned:

```tsx
<BasePage title='Metrics'
    activeRoute='/metrics/dashboard'
    scripts={['/assets/lib/chartjs-adapter-date-fns.js']}
    className="flex flex-col gap-4 py-8"
>
    <Heading className="text-center">Metrics</Heading>
    <div className="w-full px-10 flex flex-col gap-5">
        <div className="grid grid-cols-5 gap-5">
            <div className="col-span-2 flex flex-col gap-5">
                <MetricsStatus
                    automaticReloadChecked={automaticReload}
                    onReloadChange={() => automaticReload = !automaticReload} // The onReloadChange method is automatically reapplied, it just works on the client.
                    version={version}
                    className="flex-1"
                >
                </MetricsStatus>
                <RequestDurationChart className="flex-1" secondary={secondary}></RequestDurationChart>
            </div>
            <RequestsPerSecondChart secondary={secondary} className="col-span-3"></RequestsPerSecondChart>
        </div>
        <div className="grid grid-cols-2 gap-5">
            <ResourceUsageChart primary={primary} secondary={secondary}></ResourceUsageChart>
            <NetworkChart primary={primary} secondary={secondary}></NetworkChart>
        </div>
    </div>
</BasePage>
```