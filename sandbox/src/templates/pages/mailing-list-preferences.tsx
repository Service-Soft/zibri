/* eslint-disable typescript/no-non-null-assertion */
import { MailingList, MailingListSubscriber, MaskUtilities, onClient, PreactComponent } from 'zibri';

import { Button } from '../components/button';
import { Card } from '../components/card';
import { Checkbox } from '../components/checkbox';
import { EmptyPage } from '../components/empty-page';
import { Heading } from '../components/heading';

type Props = {
    subscriber: MailingListSubscriber,
    mailingLists: MailingList[]
};

type MailingListDisplayData = MailingList & {
    isSubscribedTo: boolean
};

export const MailingListPreferencesPage: PreactComponent<Props> = ({ subscriber, mailingLists }) => {
    let updateButton: HTMLButtonElement;
    let statusBar: HTMLDivElement;
    let subscriberId: string;

    const email: string = MaskUtilities.mask(subscriber.email);
    const lists: MailingListDisplayData[] = mailingLists.map(l => ({
        ...l,
        isSubscribedTo: subscriber.mailingLists.some(sl => sl.id === l.id)
    }));

    let checkedMailingListIdsPriorChanges: string[] = lists.filter(l => l.isSubscribedTo).map(l => l.id);
    let currentCheckedMailingListIds: string[] = [...checkedMailingListIdsPriorChanges];

    onClient(() => {
        updateButton = document.querySelector('#update-button')!;
        statusBar = document.querySelector('#status-bar')!;
        const subscriberIdParam: string | null = new URL(window.location.href).searchParams.get('subscriberId');
        if (!subscriberIdParam) {
            location.href = '/';
            return;
        }
        subscriberId = subscriberIdParam;
    });

    function updateCheckedMailingListIds(l: MailingListDisplayData): void {
        if (l.isSubscribedTo) {
            currentCheckedMailingListIds.push(l.id);
        }
        else {
            currentCheckedMailingListIds = currentCheckedMailingListIds.filter(id => id !== l.id);
        }

        checkIsDirty();
    }

    function checkIsDirty(): void {
        if (checkedMailingListIdsPriorChanges.find(id => !currentCheckedMailingListIds.includes(id))) {
            updateButton.disabled = false;
            return;
        }
        if (currentCheckedMailingListIds.find(id => !checkedMailingListIdsPriorChanges.includes(id))) {
            updateButton.disabled = false;
            return;
        }

        updateButton.disabled = true;
    }

    async function update(): Promise<void> {
        setIsLoading();

        const success: boolean = (await fetch(
            `/mailing-lists/preferences?subscriberId=${subscriberId}`,
            {
                method: 'PATCH',
                body: JSON.stringify({ mailingListIds: currentCheckedMailingListIds }),
                headers: { 'content-type': 'application/json' }
            }
        )).ok;

        if (success) {
            setIsSuccess();
            return;
        }

        for (const id of lists.map(l => l.id)) {
            if (!checkedMailingListIdsPriorChanges.includes(id)) {
                const checkbox: HTMLInputElement = document.querySelector(`#${id}`)!;
                checkbox.checked = false;
            }
        }
        for (const id of checkedMailingListIdsPriorChanges) {
            if (!lists.map(l => l.id).includes(id)) {
                const checkbox: HTMLInputElement = document.querySelector(`#${id}`)!;
                checkbox.checked = true;
            }
        }
        setIsFailed();
    }

    function reset(): void {
        checkedMailingListIdsPriorChanges = [...currentCheckedMailingListIds];
        checkIsDirty();
    }
    function removeStatus(): void {
        statusBar.style.backgroundColor = '';
        statusBar.textContent = '';
    }
    function setIsLoading(): void {
        updateButton.disabled = true;
        statusBar.style.backgroundColor = 'gray';
        statusBar.textContent = 'loading...';
    }
    function setIsSuccess(): void {
        removeStatus();
        statusBar.style.backgroundColor = 'green';
        statusBar.textContent = 'preferences updated';
        reset();
        setTimeout(removeStatus, 3000);
    }
    function setIsFailed(): void {
        removeStatus();
        statusBar.style.backgroundColor = 'red';
        statusBar.textContent = 'failed updating preferences';
        reset();
        setTimeout(removeStatus, 3000);
    }

    return (
        <>
            <EmptyPage title='Mailing List Preferences'>
                <Card className='text-center flex flex-col gap-6'>
                    <img className="block mx-auto" src="/assets/logo.jpg" width="200px" height="200px"/>
                    <p className="text-center">{email}</p>
                    <Heading className='my-2'>
                        Mailing list preferences
                    </Heading>
                    <ul>
                        {lists.map(l => <li className="mb-2">
                            <Checkbox onChange={() => updateCheckedMailingListIds(l)} label={l.name} id={l.id} checked={l.isSubscribedTo}>
                            </Checkbox>
                        </li>)}
                    </ul>
                    <Button onClick={() => void update()} className='mx-auto' disabled id='update-button'>Update</Button>
                    <div class="flex items-center justify-center h-6 -mt-[9px] -m-[15px] transition duration-300 ease-in" id="status-bar">
                    </div>
                </Card>
            </EmptyPage>
        </>
    );
};