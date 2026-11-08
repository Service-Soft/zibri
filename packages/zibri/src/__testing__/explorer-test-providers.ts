import { compileTsxTemplate } from './compile-tsx-template.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { OpenApiExplorerTemplate } from '../open-api/explorer/open-api-explorer.model';

/**
 * An explorer page writing what it is handed, so a test reads it from the html.
 */
const explorerTestTemplate: OpenApiExplorerTemplate = compileTsxTemplate<OpenApiExplorerTemplate>(
    'export const ExplorerPage = ({ appName, assetsRoute, versions, version, definition, versionHeader }) => <html>'
    + '<head><title>{`${appName} | Explorer`}</title></head><body>'
    + '<p id="version">{version.value}</p>'
    + '<ul>{versions.map(v => <li>{`${v.name}|${v.url}|${v.documentUrl}`}</li>)}</ul>'
    + '<p id="paths">{Object.keys(definition.paths ?? {}).join(\',\')}</p>'
    + '<p id="header">{versionHeader}</p>'
    + '<p id="assets">{assetsRoute}</p>'
    + '</body></html>;'
);

/**
 * Provides an explorer at `/explorer` to a test server, which has none without a template. Each version it
 * offers is a list item of its name, its url and the url of its document, separated by `|`.
 */
export const explorerTestProviders: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE, useValue: explorerTestTemplate })
];
