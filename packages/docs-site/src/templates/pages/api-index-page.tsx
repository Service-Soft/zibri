import { MdxHeading, TsxComponent } from 'zibri';

import { ApiCommentUtilities } from '../../api/api-comment.utilities';
import { ApiExport, ApiKind } from '../../api/api-export.model';
import { API_KIND_TITLES, ApiPageUtilities } from '../../api/api-page.utilities';
import { API_FOLDER, ApiReferenceUtilities } from '../../api/api-reference.utilities';
import { DocsLayout } from '../components/docs-layout';
import { Heading } from '../components/heading';
import { KindBadge } from '../components/kind-badge';
import { Paragraph } from '../components/paragraph';

type ApiGroup = {
    kind: ApiKind,
    title: string,
    exports: ApiExport[]
};

// the groups of the index, in the order of the sections of a page of the documentation that lists exports
const INDEX_ORDER: ApiKind[] = ['class', 'entity', 'interface', 'type', 'function', 'variable', 'enum', 'namespace'];

type ApiEntryProps = {
    apiExport: ApiExport
};

const ApiEntry: TsxComponent<ApiEntryProps> = ({ apiExport }) => {
    const [first] = apiExport.declarations;
    const summary: string = first == undefined ? '' : ApiCommentUtilities.resolveFirstSentence(ApiPageUtilities.findComment(first));
    return (
        <li className="min-w-0">
            <a href={ApiReferenceUtilities.resolveAddress(apiExport.name)} className="inline-flex items-center gap-2 hover:underline">
                <KindBadge kind={apiExport.kind}/>
                <span className="font-mono text-sm text-secondary break-all">{apiExport.name}</span>
            </a>
            <p className="mt-1 text-sm text-disabled line-clamp-2">{summary}</p>
        </li>
    );
};

// every export of zibri, grouped by kind
export const ApiIndexPageTemplate: TsxComponent = () => {
    const exports: ApiExport[] = ApiReferenceUtilities.resolveExports();
    const groups: ApiGroup[] = INDEX_ORDER
        .map(kind => ({ kind, title: API_KIND_TITLES[kind], exports: exports.filter(apiExport => apiExport.kind === kind) }))
        .filter(group => group.exports.length > 0);
    const headings: MdxHeading[] = groups.map(group => ({ depth: 2, text: group.title, id: group.kind }));
    return (
        <DocsLayout title="API reference" file={API_FOLDER} headings={headings}>
            <Heading tag="h1">API reference</Heading>
            <Paragraph>Every export of Zibri, by kind. The page of each shows how it is declared and what it is for.</Paragraph>
            {groups.map(group => <section>
                <Heading tag="h2" id={group.kind}>{group.title}</Heading>
                <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {group.exports.map(apiExport => <ApiEntry apiExport={apiExport}/>)}
                </ul>
            </section>)}
        </DocsLayout>
    );
};