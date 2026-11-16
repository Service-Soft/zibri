import { OpenApiExplorerProps, OpenApiExplorerUtilities, onClient, TsxComponent, TsxElement } from 'zibri';

import { ExplorerAsyncApi } from './explorer-async-api';
import { ExplorerOpenApi } from './explorer-open-api';
import { BasePage } from '../components/base-page';
import { Heading } from '../components/heading';
import { TabBar } from '../components/tab-bar';
import { TabItem } from '../components/tab-item';

export const ExplorerPage: TsxComponent<OpenApiExplorerProps> = ({ versions, version, definition, asyncApiDefinition, versionHeader }) => {
    // a tab for each document that describes anything, and the tabs only for both
    const hasOpenApi: boolean = OpenApiExplorerUtilities.resolveTags(definition).length > 0;
    const hasAsyncApi: boolean = Object.keys(asyncApiDefinition.operations ?? {}).length > 0;

    // a tag or an operation the user opens is named in the address, so a link to it opens it again
    onClient(() => {
        const target: HTMLElement | null = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (target != null) {
            // on the tab it is on, inside every tag around it
            const panel: HTMLElement | null = target.closest('[role="tabpanel"]');
            if (panel?.hidden === true) {
                document.getElementById(`button-${panel.id}`)?.click();
            }
            let details: HTMLDetailsElement | null = target.closest('details');
            while (details != null) {
                details.open = true;
                details = details.parentElement?.closest('details') ?? null;
            }
            target.scrollIntoView();
        }

        // the click on a summary, rather than the toggle of its details, which a details open from the start fires as well
        document.addEventListener('click', ev => {
            const summary: Element | null | undefined = ev.target instanceof Element ? ev.target.closest('summary') : undefined;
            const details: HTMLElement | null | undefined = summary?.parentElement;
            // a lock in a summary opens the authorize dialog instead
            if (ev.defaultPrevented || !(details instanceof HTMLDetailsElement) || details.id === '') {
                return;
            }
            // read before the click opens or closes it
            const opening: boolean = !details.open;
            const named: string = opening ? details.id : details.parentElement?.closest('details[open]')?.id ?? '';
            history.replaceState(null, '', named === '' ? `${location.pathname}${location.search}` : `#${encodeURIComponent(named)}`);
        });
    });

    const openApi: TsxElement = <ExplorerOpenApi
        definition={definition}
        version={version.value}
        documentUrl={version.documentUrl}
        versionHeader={versionHeader}
    />;
    const asyncApi: TsxElement = <ExplorerAsyncApi definition={asyncApiDefinition} documentUrl={version.asyncApiDocumentUrl}/>;

    return (
        <BasePage title="Explorer" activeRoute="/explorer" className="flex flex-col gap-4 w-full max-w-7xl mx-auto px-8 py-8 text-white">
            <div className="flex flex-wrap gap-4 items-center">
                <Heading id="explorer-title" className="mr-auto">
                    {definition.info.title} <span className="align-middle px-2 py-0.5 rounded-full bg-primary text-sm">
                        {definition.info.version}
                    </span>
                </Heading>
                <label className="inline-flex gap-2 items-center">
                    Version
                    <select
                        id="explorer-version"
                        className="px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white"
                        onChange={ev => {
                            location.href = ev.currentTarget.value;
                        }}
                    >
                        {versions.map(v => <option value={v.url} selected={v.value === version.value}>{v.name}</option>)}
                    </select>
                </label>
            </div>
            {hasOpenApi && hasAsyncApi
                ? <TabBar className="w-full" tabs={[{ id: 'openapi', label: 'OpenAPI' }, { id: 'asyncapi', label: 'AsyncAPI' }]}>
                    <TabItem id="openapi">{openApi}</TabItem>
                    <TabItem id="asyncapi">{asyncApi}</TabItem>
                </TabBar>
                : hasAsyncApi ? asyncApi : openApi}
        </BasePage>
    );
};