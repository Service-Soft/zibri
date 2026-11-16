import { provideContext, State, TsxComponent, TsxChildren, useState } from 'zibri';

import { CurrentTab } from './current-tab';

type Tab = {
    id: string,
    label: string
};

type Props = {
    tabs: Tab[],
    currentTabId?: string,
    children?: TsxChildren,
    className?: string
};

export const TabBar: TsxComponent<Props> = ({ tabs, children, currentTabId, className = '' }) => {
    const current: State<string> = useState(currentTabId ?? tabs.at(0)?.id ?? '');
    // the panels among the children show themselves when they are the current tab
    provideContext(CurrentTab, current.value);

    return (
        <div className={className}>
            <div role="tablist" className="flex mb-4 justify-center">
                {tabs.map(tab => <button
                    id={`button-${tab.id}`}
                    role="tab"
                    aria-controls={tab.id}
                    aria-selected={current.value === tab.id ? 'true' : 'false'}
                    className={`px-4 py-1 first:rounded-l last:rounded-r text-white cursor-pointer transition duration-300 ease-in
                        tracking-wider border-b-2 hover:border-secondary
                        ${current.value === tab.id ? 'bg-secondary border-secondary' : ''}`}
                    onClick={() => {
                        current.value = tab.id;
                    }}
                >
                    {tab.label}
                </button>)}
            </div>
            <div>
                {children}
            </div>
        </div>
    );
};