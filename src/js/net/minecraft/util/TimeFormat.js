

function timeZoneName(date) {
    try {
        const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(date);
        const match = parts.find((part) => part.type === "timeZoneName");
        if (match && match.value) {
            return match.value;
        }
    } catch (e) {
    }

    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const absolute = Math.abs(offset);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    return "UTC" + sign + hours + (minutes ? ":" + String(minutes).padStart(2, "0") : "");
}

function formatDateTime(ms) {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
        return "an unknown date";
    }

    let hours = date.getHours();
    const suffix = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;

    const minutes = String(date.getMinutes()).padStart(2, "0");
    const zone = timeZoneName(date);
    const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

    return `${day} at ${hours}:${minutes}${suffix}${zone ? " " + zone : ""}`;
}

const MARKER = /\{\{until:(\d+)\}\}/g;

function resolveTimeMarkers(text) {
    if (typeof text !== "string") {
        return text;
    }
    return text.replace(MARKER, (_match, ms) => formatDateTime(Number(ms)));
}

export { formatDateTime, resolveTimeMarkers, timeZoneName };
