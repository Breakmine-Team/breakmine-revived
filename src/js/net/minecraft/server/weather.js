import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import Logger from './logger.js';
import { getWorldType, registerWorldLifecycle } from './world.js';
import { WEATHER_CLEAR, WEATHER_RAIN, WEATHER_THUNDER } from '../util/WeatherConstants.js';

const log = Logger;
const WEATHER_FILE = 'weather.json';

let state = WEATHER_CLEAR;
let ticksLeft = 6000;
let version = 0;

function randomDuration(min, max) {
    return min + Math.floor(Math.random() * (max - min));
}

function pickNextState() {
    switch (state) {
        case WEATHER_CLEAR:
            return Math.random() < 0.4 ? WEATHER_RAIN : WEATHER_CLEAR;
        case WEATHER_RAIN: {
            const roll = Math.random();
            if (roll < 0.2) return WEATHER_CLEAR;
            if (roll < 0.5) return WEATHER_THUNDER;
            return WEATHER_RAIN;
        }
        case WEATHER_THUNDER: {
            const roll = Math.random();
            if (roll < 0.2) return WEATHER_CLEAR;
            return roll < 0.6 ? WEATHER_RAIN : WEATHER_THUNDER;
        }
        default:
            return WEATHER_CLEAR;
    }
}

function durationFor(nextState) {
    if (nextState === WEATHER_CLEAR) return randomDuration(6000, 24000);
    if (nextState === WEATHER_RAIN) return randomDuration(6000, 14400);
    return randomDuration(2400, 6000);
}

export function getWeatherState() {
    return state;
}

export function getWeatherVersion() {
    return version;
}

export function setWeatherState(nextState, durationTicks = 0) {
    if (nextState !== WEATHER_CLEAR && nextState !== WEATHER_RAIN && nextState !== WEATHER_THUNDER) {
        return false;
    }

    state = nextState;
    ticksLeft = durationTicks > 0 ? durationTicks : durationFor(nextState);
    version++;
    return true;
}

export function tickWeather() {
    // Rain over a lava sea does not make sense, so the hellish world stays clear.
    if (getWorldType() === 'hellish') {
        ticksLeft = 0;
        if (state !== WEATHER_CLEAR) {
            state = WEATHER_CLEAR;
            version++;
        }
        return;
    }

    if (ticksLeft > 0) {
        ticksLeft--;
        return;
    }

    state = pickNextState();
    ticksLeft = durationFor(state);
    version++;
}

function weatherFile(worldDir) {
    return path.join(worldDir, WEATHER_FILE);
}

function applySavedWeather(saved) {
    if (!saved || typeof saved !== 'object') {
        return false;
    }
    if (saved.state !== WEATHER_CLEAR && saved.state !== WEATHER_RAIN && saved.state !== WEATHER_THUNDER) {
        return false;
    }

    const remaining = Math.floor(Number(saved.ticksLeft));
    state = saved.state;
    ticksLeft = Number.isFinite(remaining) && remaining > 0 ? remaining : durationFor(state);
    return true;
}

function loadWeather(worldDir) {
    const file = weatherFile(worldDir);
    try {
        if (!fs.existsSync(file)) {
            return false;
        }
        return applySavedWeather(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
        log.warn('Weather', `Could not load weather: ${e.message}`);
        return false;
    }
}

function saveWeather(worldDir) {
    try {
        fs.writeFileSync(weatherFile(worldDir), JSON.stringify({ state, ticksLeft }));
    } catch (e) {
        log.warn('Weather', `Could not save weather: ${e.message}`);
    }
}

registerWorldLifecycle({
    onLoad(worldName, worldDir) {
        state = WEATHER_CLEAR;
        ticksLeft = 6000;
        loadWeather(worldDir);
        version++;
    },
    onSave(worldName, worldDir) {
        saveWeather(worldDir);
    }
});
