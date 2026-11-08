/* eslint-disable no-console */
import { io, Socket } from 'socket.io-client?client';
import { Input, onClient, Ref, State, TsxComponent, useEffect, useInput, useRef, useState, WebsocketSendDataMessage } from 'zibri';

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

type ChatMessage = {
    id: number,
    text: string,
    senderConnectionId: string,
    senderUserId: string,
    isOwn: boolean
};

type ChatBubbleProps = {
    message: ChatMessage,
    primary: string,
    secondary: string
};

const ChatBubble: TsxComponent<ChatBubbleProps> = ({ message, primary, secondary }) => {
    const shown: Input<ChatMessage> = useInput(message);
    return (
        <li
            className="p-4 rounded-xl w-fit max-w-[48%] break-all text-white"
            style={shown.value.isOwn
                ? { backgroundColor: secondary, marginLeft: 'auto' }
                : { backgroundColor: primary }}
        >
            <div>{shown.value.text}</div>
            <div>senderConnectionId: {shown.value.senderConnectionId}</div>
            <div>senderUserId: {shown.value.senderUserId}</div>
        </li>
    );
};

export const SocketIoTestPage: TsxComponent<Props> = ({ primary, secondary }: Props) => {
    let socket: Socket;
    const message: State<string> = useState('');
    const messages: State<ChatMessage[]> = useState<ChatMessage[]>([]);
    const errorTitle: State<string> = useState('...');
    const errorParagraphs: State<string[]> = useState<string[]>([]);
    const dialog: Ref<HTMLDialogElement> = useRef<HTMLDialogElement>();

    onClient(() => {
        socket = io({
            auth: {
                offset: 0
            }
        });

        socket.on('chat message', (msg, ack) => {
            messages.value = [
                ...messages.value,
                {
                    id: messages.value.length,
                    // text, never html: a message is written by whoever else is connected
                    // eslint-disable-next-line typescript/no-unsafe-member-access
                    text: String(msg.data.message),
                    // eslint-disable-next-line typescript/no-unsafe-member-access
                    senderConnectionId: String(msg.senderConnectionId),
                    // eslint-disable-next-line typescript/no-unsafe-member-access
                    senderUserId: String(msg.senderUserId),
                    // eslint-disable-next-line typescript/no-unsafe-member-access
                    isOwn: msg.senderConnectionId === socket.id
                }
            ];
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

    useEffect(() => window.scrollTo(0, document.body.scrollHeight), [messages]);

    // eslint-disable-next-line unusedImports/no-unused-vars
    function closeDialog(): void {
        errorParagraphs.value = [];
        dialog.current.close();
    }

    async function sendMessage(): Promise<void> {
        if (!message.value) {
            return;
        }

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const response: WebsocketSendDataMessage = await socket.timeout(3000)
            .emitWithAck(
                'chat message',
                {
                    headers: { Authorization: 'Bearer 12376892311' },
                    body: { message: message.value }
                }
            );

        if (response.ok) {
            message.value = '';
            return;
        }

        errorTitle.value = `Error: ${response.error?.status}`;
        errorParagraphs.value = response.error?.paragraphs ?? [];
        dialog.current.showModal();
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
                        <Heading className='text-2xl!' tag='h2'>Chats</Heading>
                        <hr className="text-white"/>
                    </div>
                    <div className="flex flex-col w-full">
                        <ul className="flex-1 overflow-scroll p-4 flex flex-col gap-4" id="messages">
                            {messages.value.map(chatMessage => <ChatBubble
                                key={chatMessage.id}
                                message={chatMessage}
                                primary={primary}
                                secondary={secondary}
                            />)}
                        </ul>
                        <Form onSubmit={() => void sendMessage()} className="bg-dark-gray p-4 rounded-br-xl">
                            <div className="flex gap-5">
                                <TextArea value={message}
                                    label={undefined}
                                    id="input"
                                    className="flex-1">
                                </TextArea>
                                <Button type="submit" id="send-button" className="min-w-36 py-4 h-full">Send</Button>
                            </div>
                        </Form>
                    </div>
                </div>

                <Dialog id="dialog" dialogRef={dialog} className="hidden open:flex flex-col gap-2">
                    <Heading id="error-dialog-title">{errorTitle.value}</Heading>
                    <div id="error-paragraphs">
                        {errorParagraphs.value.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                    </div>
                </Dialog>
            </BasePage>
        </>
    );
};