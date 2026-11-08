import { $ts, MailingList, MailingListPreferencesPageTemplate, MaskUtilities, State, useState } from 'zibri';

import { Button } from '../components/button';
import { Card } from '../components/card';
import { Checkbox } from '../components/checkbox';
import { EmptyPage } from '../components/empty-page';
import { Heading } from '../components/heading';

type MailingListDisplayData = MailingList & {
    isSubscribedTo: boolean
};

export const MailingListPreferencesPage: MailingListPreferencesPageTemplate = ({ subscriber, mailingLists, managePreferencesApiUrl }) => {
    const status: State<string> = useState('');
    const statusColor: State<string> = useState('');
    const isLoading: State<boolean> = useState(false);

    const email: string = MaskUtilities.mask(subscriber.email);
    const lists: MailingListDisplayData[] = mailingLists.map(l => ({
        ...l,
        isSubscribedTo: subscriber.mailingLists.some(sl => sl.id === l.id)
    }));

    const saved: State<string[]> = useState(lists.filter(l => l.isSubscribedTo).map(l => l.id));
    const checked: State<string[]> = useState(lists.filter(l => l.isSubscribedTo).map(l => l.id));

    function isChecked(id: string): boolean {
        return checked.value.includes(id);
    }

    function isDirty(): boolean {
        return saved.value.some(id => !checked.value.includes(id)) || checked.value.some(id => !saved.value.includes(id));
    }

    function toggleCheckedMailingListId(id: string): void {
        checked.value = checked.value.includes(id)
            ? checked.value.filter(checkedId => checkedId !== id)
            : [...checked.value, id];
    }

    async function update(): Promise<void> {
        isLoading.value = true;
        showStatus($ts`loading...`, 'gray');

        const success: boolean = await fetch(
            managePreferencesApiUrl,
            {
                method: 'PATCH',
                body: JSON.stringify({ mailingListIds: checked.value }),
                headers: { 'content-type': 'application/json' }
            }
        ).then(response => response.ok, () => false);

        isLoading.value = false;
        if (success) {
            saved.value = checked.value;
            showStatus($ts`preferences updated`, 'green');
        }
        else {
            checked.value = saved.value;
            showStatus($ts`failed updating preferences`, 'red');
        }
        setTimeout(() => showStatus('', ''), 3000);
    }

    function showStatus(text: string, color: string): void {
        status.value = text;
        statusColor.value = color;
    }

    return (
        <>
            <EmptyPage title={$ts`Mailing List Preferences`}>
                <Card className='text-center flex flex-col gap-6'>
                    <img className="block mx-auto" src="/assets/logo.jpg" width="200px" height="200px"/>
                    <p className="text-center">{email}</p>
                    <Heading className='my-2'>
                        {$ts`Mailing list preferences`}
                    </Heading>
                    <ul>
                        {lists.map(l => <li className="mb-2">
                            <Checkbox onChange={() => toggleCheckedMailingListId(l.id)} label={l.name} id={l.id} checked={isChecked(l.id)}>
                            </Checkbox>
                        </li>)}
                    </ul>
                    <Button
                        onClick={() => void update()}
                        className='mx-auto py-4'
                        disabled={isLoading.value || !isDirty()}
                        id='update-button'
                    >
                        {$ts`Update`}
                    </Button>
                    <div
                        className="flex items-center justify-center h-6 mt-[-9px] m-[-15px] transition duration-300 ease-in"
                        id="status-bar"
                        style={statusColor.value === '' ? undefined : { backgroundColor: statusColor.value }}
                    >
                        {status.value}
                    </div>
                </Card>
            </EmptyPage>
        </>
    );
};