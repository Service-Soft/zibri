import { MdxHeading, onClient, Ref, TsxComponent, useRef } from 'zibri';

type OnThisPageProps = {
    headings: MdxHeading[]
};

// the sections of the page, and the parts of each, the one being read marked as the reader scrolls
export const OnThisPage: TsxComponent<OnThisPageProps> = ({ headings }) => {
    const sections: MdxHeading[] = headings.filter(heading => heading.depth === 2 || heading.depth === 3);
    const nav: Ref<HTMLElement> = useRef<HTMLElement>();

    // the section being read: the last whose heading scrolled up past the bar, the first before any did, and the last
    // at the end of the page, where a short last section never reaches the top
    function markCurrent(): void {
        // how far below the top of the window a heading counts as read: past the bar at the top, and a little more
        const readBelowPx: number = 100;
        const links: HTMLAnchorElement[] = [...nav.current.querySelectorAll('a')];
        const atEnd: boolean = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        let current: HTMLAnchorElement | undefined = atEnd ? links[links.length - 1] : links[0];
        for (const link of atEnd ? [] : links) {
            const heading: HTMLElement | null = document.getElementById(decodeURIComponent(link.hash.slice(1)));
            if (heading !== null && heading.getBoundingClientRect().top <= readBelowPx) {
                current = link;
            }
        }
        for (const link of links) {
            if (link === current) {
                link.setAttribute('aria-current', 'location');
            }
            else {
                link.removeAttribute('aria-current');
            }
        }
    }

    onClient(() => {
        markCurrent();
        // once per frame, however often the page scrolls or the window changes its size in it
        let scheduled: boolean = false;
        const schedule: () => void = () => {
            if (!scheduled) {
                scheduled = true;
                requestAnimationFrame(() => {
                    scheduled = false;
                    markCurrent();
                });
            }
        };
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
    });

    return (
        <nav ref={nav} aria-label="On this page" className="flex flex-col gap-1 pl-3 border-l border-primary text-sm">
            <p className="mb-1 text-secondary text-xs uppercase font-semibold tracking-widest">On this page</p>
            {sections.map(heading => <a
                href={`#${heading.id}`}
                className={`block py-0.5 text-disabled hover:text-secondary aria-[current=location]:text-secondary
                    aria-[current=location]:font-semibold ${heading.depth === 3 ? 'pl-3' : ''}`}
            >
                {heading.text}
            </a>)}
        </nav>
    );
};