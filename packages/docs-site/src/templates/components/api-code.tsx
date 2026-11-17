import { TsxComponent } from 'zibri';

import { ApiToken } from '../../api/api-token.model';

type ApiCodeProps = {
    lines: ApiToken[][]
};

type ApiTokenTextProps = {
    token: ApiToken
};

const ApiTokenText: TsxComponent<ApiTokenTextProps> = ({ token }) => {
    const className: string = token.kind == undefined ? '' : `shiki-token-${token.kind}`;
    if (token.href != undefined) {
        return <a href={token.href} className={`${className} hover:underline`}>{token.text}</a>;
    }
    return token.kind == undefined ? <>{token.text}</> : <span className={className}>{token.text}</span>;
};

// code the reference prints, colored as the code blocks of the pages are, a name of an export leading to its page
export const ApiCode: TsxComponent<ApiCodeProps> = ({ lines }) => {
    return (
        <pre className="my-4 p-4 rounded-sm bg-dark-gray overflow-x-auto text-sm text-code">
            <code>
                {lines.map((line, index) => <>
                    {index > 0 ? '\n' : ''}
                    {line.map(token => <ApiTokenText token={token}/>)}
                </>)}
            </code>
        </pre>
    );
};