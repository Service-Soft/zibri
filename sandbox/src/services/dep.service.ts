import { Inject, Injectable } from "catalyx";

@Injectable()
export class DepService {
    constructor(
        @Inject('42')
        private readonly numberValue: string
    ) {}
}