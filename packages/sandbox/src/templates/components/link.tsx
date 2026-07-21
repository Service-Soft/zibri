import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    href: string,
    children: ComponentChildren,
    activeRoute?: string,
    className?: string,
    icon?: string,
    iconClassName?: string
};

export const Link: PreactComponent<Props> = ({ href, children, activeRoute, className = '', icon, iconClassName = '' }) => {
    const defaultClasses: string = 'tracking-wider hover:text-secondary transition duration-200 ease-in';
    const activeClasses: string = activeRoute === href ? 'text-secondary' : 'text-white';

    return (
        <a href={href}
            className={`${defaultClasses} ${activeClasses} ${className}`}
        >
            {icon
                ? <div className="flex gap-2 items-center">
                    <img src={icon} className={`h-8 w-8 ${iconClassName}`}></img>
                    {children}
                </div>
                : children}
        </a>
    );
};