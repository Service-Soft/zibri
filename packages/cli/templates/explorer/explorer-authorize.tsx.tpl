import { OpenApiSecuritySchemeType, Ref, Refs, State, TsxComponent, useRef, useRefs, useWritableInput } from 'zibri';

import { Button } from '../components/button';
import { Dialog } from '../components/dialog';
import { Form } from '../components/form';
import { Heading } from '../components/heading';

/**
 * A security scheme of the document, as the user enters what a request is sent with.
 */
export type ExplorerAuthorizeScheme = {
    name: string,
    type: OpenApiSecuritySchemeType,
    description: string,
    // the scheme of `http`, such as `bearer`
    scheme: string,
    // where an `apiKey` goes: `header`, `query` or `cookie`
    location: string,
    // the name of the header or query parameter of an `apiKey`
    parameterName: string
};

type Props = {
    schemes: ExplorerAuthorizeScheme[],
    credentials: State<Record<string, string>>
};

/**
 * What a scheme asks the user for, or says it needs nothing.
 * @param scheme - The scheme.
 * @returns Undefined for a scheme the browser applies itself, such as a cookie or a client certificate.
 */
function resolveLabel(scheme: ExplorerAuthorizeScheme): string | undefined {
    switch (scheme.type) {
        case 'http': {
            return scheme.scheme.toLowerCase() === 'basic' ? 'username:password' : 'Token';
        }
        case 'oauth2':
        case 'openIdConnect': {
            return 'Access token';
        }
        case 'apiKey': {
            return scheme.location === 'cookie' ? undefined : `${scheme.parameterName} (${scheme.location})`;
        }
        case 'mutualTLS': {
            return undefined;
        }
    }
}

/**
 * What a scheme the browser applies itself needs of the user.
 * @param scheme - The scheme.
 * @returns The text.
 */
function resolveNote(scheme: ExplorerAuthorizeScheme): string {
    return scheme.type === 'mutualTLS'
        ? 'The browser presents the client certificate it holds for this site.'
        : `The browser sends the cookie ${scheme.parameterName} once you are logged in.`;
}

export const ExplorerAuthorize: TsxComponent<Props> = ({ schemes, credentials }) => {
    const entered: State<Record<string, string>> = useWritableInput(credentials);
    const dialog: Ref<HTMLDialogElement> = useRef<HTMLDialogElement>();
    const inputs: Refs<HTMLInputElement> = useRefs<HTMLInputElement>();

    function open(): void {
        for (const input of inputs.current) {
            input.value = entered.value[input.dataset['scheme'] ?? ''] ?? '';
        }
        dialog.current.showModal();
    }

    function save(): void {
        const next: Record<string, string> = {};
        for (const input of inputs.current) {
            if (input.value !== '') {
                next[input.dataset['scheme'] ?? ''] = input.value;
            }
        }
        entered.value = next;
        dialog.current.close();
    }

    return (
        <div>
            <Button id="explorer-authorize" className="inline-flex! gap-2 items-center" onClick={() => open()}>
                <img
                    id="explorer-authorize-lock-closed"
                    className="h-5 w-5"
                    src="/assets/lock.svg"
                    alt=""
                    hidden={Object.keys(entered.value).length === 0}
                />
                <img
                    id="explorer-authorize-lock-open"
                    className="h-5 w-5"
                    src="/assets/lock-open.svg"
                    alt=""
                    hidden={Object.keys(entered.value).length > 0}
                />
                <span id="explorer-authorize-label">{Object.keys(entered.value).length ? 'Authorized' : 'Authorize'}</span>
            </Button>
            <Dialog id="explorer-authorize-dialog" dialogRef={dialog} className="w-[min(600px,90vw)] p-6 bg-gray text-white backdrop:bg-[rgba(0,0,0,0.6)]">
                <Form onSubmit={() => save()}>
                    <Heading tag="h3" className="text-2xl!">Available authorizations</Heading>
                    {schemes.map(scheme => <div className="flex flex-col gap-1.5 py-3 border-b border-disabled-dark">
                        <Heading tag="h4" className="text-lg! font-semibold">
                            {scheme.name} <span className="font-normal text-disabled">({scheme.type}{scheme.scheme === '' ? '' : `, ${scheme.scheme}`})</span>
                        </Heading>
                        {scheme.description !== '' && <p>{scheme.description}</p>}
                        {resolveLabel(scheme) == undefined
                            ? <p className="text-disabled">{resolveNote(scheme)}</p>
                            : <label className="flex gap-2 items-center">
                                {resolveLabel(scheme)}
                                <input
                                    id={`explorer-authorize-${scheme.name}`}
                                    ref={inputs}
                                    data-scheme={scheme.name}
                                    type="password"
                                    autocomplete="off"
                                    className="flex-1 px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white"
                                />
                            </label>}
                    </div>)}
                    <div className="flex gap-3 pt-4">
                        <Button id="explorer-authorize-save" type="submit">Authorize</Button>
                        <Button
                            id="explorer-authorize-clear"
                            onClick={() => {
                                entered.value = {};
                                dialog.current.close();
                            }}
                        >
                            Log out
                        </Button>
                        <Button id="explorer-authorize-close" onClick={() => dialog.current.close()}>Close</Button>
                    </div>
                </Form>
            </Dialog>
        </div>
    );
};