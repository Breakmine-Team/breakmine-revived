import Packet from "../../../Packet.js";

export default class ServerWeatherUpdatePacket extends Packet {

    constructor(weatherState = 0) {
        super();

        this.weatherState = weatherState;
    }

    read(buffer) {
        this.weatherState = buffer.readUnsignedByte();
    }

    handle(handler) {
        handler.handleWeatherUpdate(this);
    }

    getState() {
        return this.weatherState;
    }
}
