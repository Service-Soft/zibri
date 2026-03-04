import { ComponentChildren } from 'preact';
import { GlobalRegistry, onServer, PreactComponent } from 'zibri';

type Props = {
    title: string,
    children: ComponentChildren,
    className?: string,
    scripts?: string[]
};

export const EmptyPage: PreactComponent<Props> = ({ title, children, className = '', scripts = [] }) => {
    let finalTitle: string = title;

    onServer(() => {
        const appName: string = GlobalRegistry.getAppData('name') ?? '';
        finalTitle = title.length ? `${title} | ${appName}` : appName;
    });

    return (
        <html lang="en">
            <head>
                <meta charset="utf-8"/>
                <title>{finalTitle}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="icon" type="image/png" href="/assets/favicon.png" />
                <link rel="stylesheet" href="/assets/style.css" />
                {scripts.map(s => <script defer src={s}></script>)}
            </head>
            <body className={className}>
                {children}
            </body>
        </html>
    );
};