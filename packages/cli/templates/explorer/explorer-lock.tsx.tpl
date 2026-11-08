import { Input, TsxComponent, useContext, useInput } from 'zibri';

import { ExplorerCredentials } from './explorer-context';

type Props = {
    id: string,
    // the security schemes the operation accepts
    schemes: string[]
};

export const ExplorerLock: TsxComponent<Props> = ({ id, schemes }) => {
    const credentials: Input<Record<string, string>> = useInput(useContext(ExplorerCredentials));
    const title: string = `Requires a login with ${schemes.join(' or ')}`;

    return (
        <button
            id={id}
            type="button"
            title={title}
            aria-label={title}
            className="p-1 rounded cursor-pointer transition duration-300 ease-in hover:bg-gray"
            onClick={ev => {
                // the lock sits in the summary of the operation, which would open or close it as well
                ev.preventDefault();
                document.getElementById('explorer-authorize')?.click();
            }}
        >
            <img
                id={`${id}-closed`}
                className="h-5 w-5"
                src="/assets/lock.svg"
                alt=""
                hidden={!schemes.some(name => (credentials.value[name] ?? '') !== '')}
            />
            <img
                id={`${id}-open`}
                className="h-5 w-5"
                src="/assets/lock-open.svg"
                alt=""
                hidden={schemes.some(name => (credentials.value[name] ?? '') !== '')}
            />
        </button>
    );
};
