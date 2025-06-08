import { Inject, Injectable } from 'zibri';

@Injectable()
export class DepService {
    constructor(
        @Inject('42')
        private readonly numberValue: string
    ) {}
}