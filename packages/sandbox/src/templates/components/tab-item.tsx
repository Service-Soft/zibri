import { Input, TsxComponent, TsxChildren, useContext, useInput } from 'zibri';

import { CurrentTab } from './current-tab';

type Props = {
    id: string,
    children: TsxChildren,
    className?: string
};

export const TabItem: TsxComponent<Props> = ({ id, className = '', children }) => {
    const current: Input<string> = useInput(useContext(CurrentTab));

    return (
        <div id={id} role="tabpanel" aria-labelledby={`button-${id}`} hidden={current.value !== id} className={className}>
            {children}
        </div>
    );
};