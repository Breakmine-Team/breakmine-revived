export default class Biome {

    constructor(id, name, temperature, humidity) {
        this.id = id;
        this.name = name;
        this.temperature = temperature;
        this.humidity = humidity;
    }

    getTemperature() {
        return this.temperature;
    }

    getHumidity() {
        return this.humidity;
    }
}
