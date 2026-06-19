import { $ts, PreactComponent } from 'zibri';

import { Link } from './link';

type Props = {
    activeRoute: string
};

export const Navbar: PreactComponent<Props> = ({ activeRoute }) => {
    return (
        <nav className="bg-dark-gray px-6 shadow-elevation">
            <div className="flex items-center justify-center gap-8">
                <a href="/">
                    <img src="/assets/logo.jpg" className="w-28 h-28"></img>
                </a>
                <Link href="/" activeRoute={activeRoute}>
                    {$ts`Home`}
                </Link>
                <Link href="/explorer" activeRoute={activeRoute}>
                    {$ts`OpenAPI Explorer`}
                </Link>
                <Link href="/assets" activeRoute={activeRoute}>
                    {$ts`Assets`}
                </Link>
                {/* <Link href="/metrics/dashboard" activeRoute={activeRoute}>
                    Metrics
                </Link> */}
            </div>
        </nav>
    );
};