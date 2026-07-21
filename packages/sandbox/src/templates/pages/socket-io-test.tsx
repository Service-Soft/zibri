/* eslint-disable no-console */
/* eslint-disable typescript/no-non-null-assertion */
import { io, Socket } from 'socket.io-client?client';
import { onClient, PreactComponent, WebsocketSendDataMessage } from 'zibri';

import { BasePage } from '../components/base-page';
import { Button } from '../components/button';
import { Dialog } from '../components/dialog';
import { Form } from '../components/form';
import { Heading } from '../components/heading';
import { TextArea } from '../components/textarea';

type Props = {
    primary: string,
    secondary: string
};

export const SocketIoTestPage: PreactComponent<Props> = ({ primary, secondary }: Props) => {
    let socket: Socket;
    let message: string = '';
    let dialog: HTMLDialogElement;
    let errorParagraphs: HTMLDivElement;

    onClient(() => {
        socket = io({
            auth: {
                offset: 0
            }
        });
        dialog = document.querySelector('#dialog')!;
        errorParagraphs = document.querySelector('#error-paragraphs')!;

        socket.on('chat message', (msg, ack) => {
            const item: HTMLLIElement = document.createElement('li');
            item.style.padding = '16px';
            item.style.borderRadius = '12px';
            item.style.width = 'fit-content';
            item.style.maxWidth = '48%';
            item.style.wordBreak = 'break-all';
            item.style.color = 'whitesmoke';

            item.innerHTML = [
                // eslint-disable-next-line typescript/no-unsafe-member-access
                `<div>${msg.data.message}</div>`,
                // eslint-disable-next-line typescript/no-unsafe-member-access
                `<div>senderConnectionId: ${msg.senderConnectionId}</div>`,
                // eslint-disable-next-line typescript/no-unsafe-member-access
                `<div>senderUserId: ${msg.senderUserId}</div>`
            ].join('\n');
            // eslint-disable-next-line typescript/no-unsafe-member-access
            if (msg.senderConnectionId === socket.id) {
                item.style.backgroundColor = secondary;
                item.style.marginLeft = 'auto';
            }
            else {
                item.style.backgroundColor = primary;
            }
            const messages: HTMLUListElement = document.querySelector('#messages')!;
            messages.appendChild(item);
            window.scrollTo(0, document.body.scrollHeight);
            if (typeof ack === 'function') {
                // eslint-disable-next-line typescript/no-unsafe-call
                ack();
            }
        });

        // eslint-disable-next-line unusedImports/no-unused-vars
        socket.onAny((ev, msg, _ack) => {
            console.debug('got a new message:', ev, msg, '\n');
            if (typeof socket.auth === 'function') {
                return;
            }
            // eslint-disable-next-line typescript/no-unsafe-member-access
            if (msg.seq > socket.auth.offset) {
                // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
                socket.auth.offset = msg.seq;
                // eslint-disable-next-line typescript/no-unsafe-member-access
                console.debug('set offset to', msg.seq);
            }
        });
    });

    // eslint-disable-next-line unusedImports/no-unused-vars
    function closeDialog(): void {
        errorParagraphs.replaceChildren();
        dialog.close();
    }

    function updateMessage(value: string): void {
        const input: HTMLTextAreaElement = document.querySelector('#input')!;
        message = value;
        input.value = value;
    }

    async function sendMessage(): Promise<void> {
        if (!message) {
            return;
        }

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const response: WebsocketSendDataMessage = await socket.timeout(3000)
            .emitWithAck(
                'chat message',
                {
                    headers: { Authorization: 'Bearer 12376892311' },
                    body: { message }
                }
            );

        if (response.ok) {
            updateMessage('');
            return;
        }

        const errorDialogTitle: Element = document.querySelector('#error-dialog-title')!;
        errorDialogTitle.textContent = `Error: ${response.error?.status}`;
        for (const p of response.error?.paragraphs ?? []) {
            const item: HTMLParagraphElement = document.createElement('p');
            item.textContent = p;
            errorParagraphs.appendChild(item);
        }
        dialog.showModal();
        console.error(response.error);
    }

    return (
        <>
            <BasePage title='Socket IO'
                activeRoute='/socket-io'
                className="flex flex-col px-10 gap-4 py-8"
            >
                <Heading className="text-center">Socket Test</Heading>
                <div className="flex h-[65vh] bg-disabled-dark rounded-xl shadow-elevation">
                    <div className="rounded-l-xl bg-dark-gray w-1/3 p-4">
                        <Heading className='!text-2xl' tag='h2'>Chats</Heading>
                        <hr className="text-white"/>
                    </div>
                    <div className="flex flex-col w-full">
                        <ul className="flex-1 overflow-scroll p-4 flex flex-col gap-4" id="messages"></ul>
                        <Form onSubmit={() => void sendMessage()} className="bg-dark-gray p-4 rounded-br-xl">
                            <div className="flex gap-5">
                                <TextArea onChange={(value) => updateMessage(value)}
                                    label={undefined}
                                    id="input"
                                    className="flex-1">
                                </TextArea>
                                <Button type="submit" className="min-w-36 h-full">Send</Button>
                            </div>
                        </Form>
                    </div>
                </div>

                <Dialog id="dialog" className="hidden open:flex flex-col gap-2">
                    <Heading id="error-dialog-title">...</Heading>
                    <div id="error-paragraphs"></div>
                </Dialog>
            </BasePage>
        </>
    );
};