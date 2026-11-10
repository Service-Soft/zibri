import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { TsxComponent } from 'zibri';

import { ApiCode } from './api-code';
import { ApiComment } from './api-comment';
import { ApiSignatures } from './api-signatures';
import { Heading } from './heading';
import { ApiPageUtilities } from '../../api/api-page.utilities';
import { ApiReferenceUtilities } from '../../api/api-reference.utilities';
import { ApiToken } from '../../api/api-token.model';
import { ApiTypeUtilities } from '../../api/api-type.utilities';

type ApiMemberProps = {
    member: JSONOutput.DeclarationReflection
};

// a member of an export under a heading of its own, which a link to it names
export const ApiMember: TsxComponent<ApiMemberProps> = ({ member }) => {
    const inheritedFrom: JSONOutput.ReferenceType | undefined = member.inheritedFrom;
    const inheritedHref: string | undefined = typeof inheritedFrom?.target === 'number'
        ? ApiReferenceUtilities.findAddressOf(inheritedFrom.target)
        : undefined;
    const lines: ApiToken[][] = ApiTypeUtilities.resolveMemberLines(member);
    return (
        <section>
            <Heading tag="h3" id={ApiReferenceUtilities.resolveMemberAnchor(member.name)}>{member.name}</Heading>
            {inheritedFrom == undefined
                ? <></>
                : <p className="text-sm text-disabled">
                    Inherited from {inheritedHref == undefined
                        ? inheritedFrom.name
                        : <a href={inheritedHref} className="text-secondary hover:underline">{inheritedFrom.name}</a>}
                </p>}
            {member.signatures == undefined
                ? <><ApiCode lines={lines}/><ApiComment comment={ApiPageUtilities.findComment(member)}/></>
                : <ApiSignatures lines={lines} signatures={member.signatures}/>}
        </section>
    );
};