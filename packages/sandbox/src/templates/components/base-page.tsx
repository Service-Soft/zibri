import { TsxComponent, TsxChildren } from 'zibri';

import { EmptyPage } from './empty-page';
import { Navbar } from './navbar';

type Props = {
    title: string,
    children: TsxChildren,
    activeRoute: string,
    className?: string,
    scripts?: string[]
};

export const BasePage: TsxComponent<Props> = ({ title, children, className, scripts, activeRoute }) => {
    return (
        <EmptyPage title={title} scripts={scripts}>
            <Navbar activeRoute={activeRoute}/>
            <div className={className}>
                {children}
            </div>
        </EmptyPage>
    );
};