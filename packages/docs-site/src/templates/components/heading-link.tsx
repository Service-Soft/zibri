import { State, TsxComponent, useState } from 'zibri';

type HeadingLinkProps = {
    // the anchor of the heading it stands beside
    id: string
};

// beside a heading, shown while the pointer is on the heading: leads to its anchor, and copies the address with it, which
// a reader shares to point at the section. A `#`, as many documentations mark it, and a check mark once it was copied.
// Dimmed on a screen without hover
export const HeadingLink: TsxComponent<HeadingLinkProps> = ({ id }) => {
    const copied: State<boolean> = useState(false);

    // the address bar holds the link either way, where the clipboard is out of reach
    async function copy(): Promise<void> {
        try {
            await navigator.clipboard.writeText(location.href);
        }
        catch {
            return;
        }
        copied.value = true;
        setTimeout(() => {
            copied.value = false;
        }, 1500);
    }

    return (
        <a
            id={`link-to-${id}`}
            href={`#${id}`}
            aria-label="Copy the link to this section"
            className="ml-2 text-secondary font-normal no-underline opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                [@media(hover:none)]:opacity-50"
            onClick={event => {
                event.preventDefault();
                history.replaceState(null, '', `#${id}`);
                void copy();
            }}
        >
            <span aria-hidden="true">{copied.value ? '✓' : '#'}</span>
        </a>
    );
};