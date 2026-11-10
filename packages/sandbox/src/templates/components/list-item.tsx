import { MdxListItemProps, TsxComponent } from 'zibri';

// an item of a task list shows its checkbox in place of the bullet
export const ListItem: TsxComponent<MdxListItemProps> = ({ checked, children }) => {
    return checked === undefined
        ? <li className="my-1">{children}</li>
        : <li className="my-1 list-none flex gap-2 items-baseline">
            <input type="checkbox" checked={checked} disabled className="accent-secondary"/>
            {children}
        </li>;
};