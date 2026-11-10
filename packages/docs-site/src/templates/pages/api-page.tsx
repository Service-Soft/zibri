import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { TsxComponent } from 'zibri';

import { ApiExport } from '../../api/api-export.model';
import { ApiPageUtilities } from '../../api/api-page.utilities';
import { API_FOLDER } from '../../api/api-reference.utilities';
import { ApiSection } from '../../api/api-section.model';
import { ApiToken } from '../../api/api-token.model';
import { ApiTypeUtilities } from '../../api/api-type.utilities';
import { REFLECTION_KINDS } from '../../api/reflection-kinds';
import { ApiCode } from '../components/api-code';
import { ApiComment } from '../components/api-comment';
import { ApiMember } from '../components/api-member';
import { ApiSignatures } from '../components/api-signatures';
import { DocsLayout } from '../components/docs-layout';
import { Heading } from '../components/heading';
import { KindBadge } from '../components/kind-badge';

type ApiPageProps = {
    apiExport: ApiExport
};

type ApiDeclarationProps = {
    declaration: JSONOutput.DeclarationReflection
};

// how a name is declared and what its JSDoc says; a function each signature with its own
const ApiDeclaration: TsxComponent<ApiDeclarationProps> = ({ declaration }) => {
    const lines: ApiToken[][] = ApiTypeUtilities.resolveDeclarationLines(declaration);
    return declaration.kind === REFLECTION_KINDS.Function
        ? <ApiSignatures lines={lines} signatures={declaration.signatures ?? []}/>
        : <><ApiCode lines={lines}/><ApiComment comment={declaration.comment}/></>;
};

// the page of an export of zibri: how it is declared, its JSDoc, and its members by kind
export const ApiPageTemplate: TsxComponent<ApiPageProps> = ({ apiExport }) => {
    const sections: ApiSection[] = ApiPageUtilities.resolveSections(apiExport);
    return (
        <DocsLayout title={apiExport.name} file={API_FOLDER} headings={ApiPageUtilities.resolveHeadings(sections)}>
            <Heading tag="h1">
                <span className="inline-flex items-center gap-3"><KindBadge kind={apiExport.kind}/>{apiExport.name}</span>
            </Heading>
            {apiExport.declarations.map(declaration => <ApiDeclaration declaration={declaration}/>)}
            {sections.map(section => <section>
                <Heading tag="h2" id={section.id}>{section.title}</Heading>
                {section.members.map(member => <ApiMember member={member}/>)}
            </section>)}
        </DocsLayout>
    );
};