import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

import { EmptyPage } from './empty-page';
import { Navbar } from './navbar';

type Props = {
    title: string,
    children: ComponentChildren,
    activeRoute: string,
    className?: string,
    scripts?: string[]
};

export const BasePage: PreactComponent<Props> = ({ title, children, className, scripts, activeRoute }) => {
    return (
        <EmptyPage title={title} scripts={scripts}>
            <Navbar activeRoute={activeRoute}/>
            <div className={className}>
                {children}
            </div>
        </EmptyPage>
    );
};