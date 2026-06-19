import { ComponentChildren } from 'preact';
import { $ts, onClient, PreactComponent } from 'zibri';

type Tab = {
    id: string,
    label: string
};

type Props = {
    tabs: Tab[],
    currentTabId?: string,
    children?: ComponentChildren,
    className?: string
};

export const TabBar: PreactComponent<Props> = ({ tabs, children, currentTabId: initialCurrentTabId, className = '' }) => {
    let currentTabId: string = initialCurrentTabId ?? tabs.at(0)?.id ?? '';

    onClient(() => changeTab(currentTabId));

    function changeTab(tabId: string): void {
        const element: HTMLElement | null = document.getElementById(tabId);
        if (!element) {
            throw new Error($ts`TabPanel with id "${tabId}" could not be found`);
        }
        const buttonElement: HTMLElement | null = document.getElementById(`button-${tabId}`);
        if (!buttonElement) {
            throw new Error($ts`Button with id "button-${tabId}" could not be found`);
        }

        for (const tab of tabs) {
            const element: HTMLElement | null = document.getElementById(tab.id);
            if (!element) {
                throw new Error($ts`TabPanel with id "${tab.id}" could not be found`);
            }
            const buttonElement: HTMLElement | null = document.getElementById(`button-${tab.id}`);
            if (!buttonElement) {
                throw new Error($ts`Button with id "button-${tab.id}" could not be found`);
            }
            buttonElement.classList.remove('bg-secondary', 'border-secondary');
            element.style.display = 'none';
        }

        currentTabId = tabId;
        buttonElement.classList.add('bg-secondary', 'border-secondary');
        element.style.display = 'block';
    }

    return (
        <div className={className}>
            <div className="flex mb-4 justify-center">
                {tabs.map(tab => <button
                    id={`button-${tab.id}`}
                    className={'px-4 py-1 text-white transition duration-300 ease-in tracking-wider border-b-2 hover:border-secondary'}
                    onClick={() => changeTab(tab.id)}
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