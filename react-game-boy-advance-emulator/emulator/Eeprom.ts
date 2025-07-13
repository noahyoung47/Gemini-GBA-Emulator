
import { EepromState } from "./types";

enum State {
    IDLE,
    READ_ADDRESS,
    READ_DATA,
    WRITE_DATA
}

export class Eeprom {
    size: number;
    addressBits: number;
    data: Uint8Array;
    
    state = State.IDLE;
    address = 0;
    bit = 0;
    readBits = 0;
    writeBits = 0;
    out = 1;

    constructor(size: number) {
        this.size = size;
        this.addressBits = size > 512 ? 14 : 6;
        this.data = new Uint8Array(size);
    }
    
    reset() {
        this.state = State.IDLE;
        this.address = 0;
        this.bit = 0;
        this.readBits = 0;
        this.writeBits = 0;
        this.out = 1;
    }
    
    getMemory(): Uint8Array {
        return this.data;
    }

    load(data: Uint8Array) {
        if(data.length === this.size) {
            this.data.set(data);
        }
    }

    getState(): EepromState {
        return {
            size: this.size,
            data: this.data,
            state: this.state,
            address: this.address,
            bit: this.bit,
            readBits: this.readBits,
            writeBits: this.writeBits,
            out: this.out,
        };
    }

    loadState(state: EepromState) {
        this.size = state.size;
        this.data = new Uint8Array(state.size);
        this.data.set(state.data);
        this.state = state.state;
        this.address = state.address;
        this.bit = state.bit;
        this.readBits = state.readBits;
        this.writeBits = state.writeBits;
        this.out = state.out;
    }

    read(): number {
        return this.out;
    }

    write(value: number) {
        switch (this.state) {
            case State.IDLE:
                this.state = State.READ_ADDRESS;
                this.address = 0;
                this.bit = 0;
                this.readBits = 0;
                this.writeBits = 0;
                this.out = 1;
                // fall through
            case State.READ_ADDRESS:
                if (this.bit < 2) { // Read command type
                    this.address |= (value << (1 - this.bit));
                } else if (this.bit < 2 + this.addressBits) { // Read address
                    this.address |= (value << (1 + this.addressBits - this.bit));
                }
                
                this.bit++;
                if (this.bit === 2 + this.addressBits) {
                    this.address &= 0x3FFF;
                    if ((this.address >> (this.addressBits + 2 - 8)) === 0b10) { // WRITE
                        this.state = State.WRITE_DATA;
                        this.bit = 0;
                    } else if ((this.address >> (this.addressBits + 2 - 8)) === 0b11) { // READ
                        this.state = State.READ_DATA;
                        this.out = 0; // Dummy bit
                        this.bit = 0;
                    } else {
                        this.state = State.IDLE;
                    }
                    this.address &= (1 << this.addressBits) - 1;
                }
                break;

            case State.READ_DATA:
                if (this.readBits < 4) { // Dummy bits
                    this.out = 0;
                } else {
                    const byteAddr = Math.floor((this.address * 8 + (this.readBits - 4)) / 8);
                    const bitInByte = 7 - ((this.readBits - 4) % 8);
                    this.out = (this.data[byteAddr] >> bitInByte) & 1;
                }
                this.readBits++;
                if (this.readBits === 68) {
                    this.out = 1;
                    this.state = State.IDLE;
                }
                break;
            
            case State.WRITE_DATA:
                const byteAddr = Math.floor((this.address * 8 + this.writeBits) / 8);
                const bitInByte = 7 - (this.writeBits % 8);

                if (value === 1) {
                    this.data[byteAddr] |= (1 << bitInByte);
                } else {
                    this.data[byteAddr] &= ~(1 << bitInByte);
                }

                this.writeBits++;
                this.out = 1; // Device is busy

                if (this.writeBits === 64) {
                    this.bit = 0;
                    this.state = State.IDLE;
                }
                break;
        }
    }
}
