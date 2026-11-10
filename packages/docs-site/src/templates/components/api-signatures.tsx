import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { TsxComponent } from 'zibri';

import { ApiCode } from './api-code';
import { ApiComment } from './api-comment';
import { ApiToken } from '../../api/api-token.model';

type ApiSignaturesProps = {
    // the line each signature is declared with, in the order of the signatures
    lines: ApiToken[][],
    signatures: JSONOutput.SignatureReflection[]
};

// the signatures of a function or a method, each with its own JSDoc and parameters
export const ApiSignatures: TsxComponent<ApiSignaturesProps> = ({ lines, signatures }) => {
    return (
        <>
            {signatures.map((signature, index) => <>
                <ApiCode lines={[lines[index] ?? []]}/>
                <ApiComment comment={signature.comment} parameters={signature.parameters}/>
            </>)}
        </>
    );
};