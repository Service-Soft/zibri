import { TsxComponent } from 'zibri';

import { ApiKind } from '../../api/api-export.model';

type KindBadgeProps = {
    kind: ApiKind,
    // small in front of a code span of the text, the size of a title otherwise
    size?: 'small' | 'normal'
};

const SIZE_CLASSES: Record<NonNullable<KindBadgeProps['size']>, string> = {
    // in the middle of the line of the text it stands in
    small: 'min-w-4 h-4 mr-1 align-middle text-[9px]',
    normal: 'min-w-5 h-5 text-[11px]'
};

type BadgeLook = {
    letter: string,
    classes: string
};

/**
 * The letter and colors of the badge of each kind: VS Code's colors of icons of symbols, and typedoc's letters but for
 * an entity, which it lacks.
 */
export const BADGE_LOOKS: Record<ApiKind, BadgeLook> = {
    class: { letter: 'C', classes: 'text-[#ee9d28] border-[#ee9d28]' },
    entity: { letter: 'E', classes: 'text-[#89d185] border-[#89d185]' },
    interface: { letter: 'I', classes: 'text-[#75beff] border-[#75beff]' },
    type: { letter: 'T', classes: 'text-[#4ec9b0] border-[#4ec9b0]' },
    function: { letter: 'F', classes: 'text-[#b180d7] border-[#b180d7]' },
    variable: { letter: 'V', classes: 'text-[#9cdcfe] border-[#9cdcfe]' },
    enum: { letter: 'En', classes: 'text-[#d7ba7d] border-[#d7ba7d]' },
    namespace: { letter: 'N', classes: 'text-disabled border-disabled' }
};

// what an export is, at a glance; a screen reader reads the kind as a word
export const KindBadge: TsxComponent<KindBadgeProps> = ({ kind, size = 'normal' }) => {
    const look: BadgeLook = BADGE_LOOKS[kind];
    return (
        <span
            className={`inline-flex shrink-0 items-center justify-center px-0.5 rounded-sm border bg-dark-gray font-mono
                leading-none font-bold not-italic ${SIZE_CLASSES[size]} ${look.classes}`}
        >
            <span aria-hidden="true">{look.letter}</span>
            <span className="sr-only">{kind}</span>
        </span>
    );
};