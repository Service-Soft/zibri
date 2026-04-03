import { MailingListUnsubscribeConfirmationPageTemplate, MaskUtilities } from 'zibri';

import { Card } from '../components/card';
import { EmptyPage } from '../components/empty-page';
import { Heading } from '../components/heading';

export const MailingListUnsubscribeConfirmationPage: MailingListUnsubscribeConfirmationPageTemplate = ({
    subscriber,
    mailingList,
    managePreferencesLink
}) => {
    const email: string = MaskUtilities.mask(subscriber.email);

    return (
        <EmptyPage title='Unsubscribed successfully'>
            <Card className='text-center flex flex-col gap-6'>
                <img className="block mx-auto" src="/assets/logo.jpg" width="200px" height="200px"/>
                <p>{email}</p>
                <Heading className="my-2">
                    You've unsubscribed from
                    <br/>
                    {mailingList.name}
                </Heading>
                <p className="mb-4">
                    We are sad to see you go 😕
                </p>
                <div>
                    <hr/>
                </div>
                <p>
                    Unsubscribed by accident?
                    <br/>
                    <a href={managePreferencesLink}>Manage your preferences</a>
                </p>
            </Card>
        </EmptyPage>
    );
};