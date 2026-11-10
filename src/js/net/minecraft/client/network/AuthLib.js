const TOKEN_STORAGE_KEY = 'authToken';

export function isLocalNetwork() {
    const hostname = window.location.hostname;

    if (hostname === 'localhost' || hostname.endsWith('.local')) {
        return true;
    }

    const ipV4Loopback = /^127\./;
    const ipV4PrivateA = /^10\./;
    const ipV4PrivateB = /^172\.(1[6-9]|2[0-9]|3[0-1])\./;
    const ipV4PrivateC = /^192\.168\./;
    const ipV4LinkLocal = /^169\.254\./;

    const ipV6Loopback = /^::1$/;
    const ipV6UniqueLocal = /^[fF][cCdD]/;
    const ipV6LinkLocal = /^[fF][eE][89aAbB]/;

    const cleanHost = hostname.replace(/[\[\]]/g, '');

    return (
        ipV4Loopback.test(cleanHost) ||
        ipV4PrivateA.test(cleanHost) ||
        ipV4PrivateB.test(cleanHost) ||
        ipV4PrivateC.test(cleanHost) ||
        ipV4LinkLocal.test(cleanHost) ||
        ipV6Loopback.test(cleanHost) ||
        ipV6UniqueLocal.test(cleanHost) ||
        ipV6LinkLocal.test(cleanHost)
    );
}

let API_BASE_URL = 'https://api.breakmine.com';
let API_WS_URL = null;

export function setApiBaseUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return;
    API_BASE_URL = url.startsWith('http://') || url.startsWith('https://') ? url : 'https://' + url;
}

export function getApiBaseUrl() {
    return API_BASE_URL;
}





function defaultApiWebSocketUrl() {
    try {
        const url = new URL(API_BASE_URL);
        url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
        url.pathname = '/api-ws';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch (err) {
        return null;
    }
}

export function getApiWebSocketUrl() {
    return API_WS_URL || defaultApiWebSocketUrl();
}

export function setApiWebSocketUrl(url) {
    if (typeof url !== 'string' || url.length === 0) {
        API_WS_URL = null;
        return;
    }

    if (url.startsWith('ws://') || url.startsWith('wss://')) {
        API_WS_URL = url;
    } else {
        const parsed = new URL(url.startsWith('http://') || url.startsWith('https://') ? url : 'https://' + url);
        parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
        parsed.pathname = '/api-ws';
        parsed.search = '';
        parsed.hash = '';
        API_WS_URL = parsed.toString();
    }
}

export class AuthLibInfo {
    static VERSION = "1.3.0";
    static NAME = "AuthLib";

    constructor() {
    }
}

export function saveAuthToken(token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function getAuthToken() {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearAuthToken() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
}




class ApiTransportError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ApiTransportError';
    }
}


let webSocketRequestId = 0;

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function requestOverWebSocket(method, endpoint, { headers = {}, body = null, timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
        const url = getApiWebSocketUrl();
        if (!url) {
            reject(new ApiTransportError('WebSocket API is not available'));
            return;
        }

        let socket;
        try {
            socket = new WebSocket(url);
        } catch (err) {
            reject(new ApiTransportError('WebSocket API connection failed'));
            return;
        }

        const id = `req-${++webSocketRequestId}`;
        let settled = false;

        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(connectTimer);
            clearTimeout(requestTimer);
            try { socket.close(); } catch (e) {  }
            if (error) reject(error); else resolve(value);
        };

        const connectTimer = setTimeout(
            () => finish(new ApiTransportError('WebSocket API connection timed out')),
            Math.min(timeoutMs, 8000)
        );
        const requestTimer = setTimeout(
            () => finish(new ApiTransportError('WebSocket API request timed out')),
            timeoutMs
        );

        socket.onopen = () => {
            clearTimeout(connectTimer);

            const payload = { id, method, path: endpoint, headers };
            if (body === null || body === undefined) {
            } else if (typeof body === 'string') {
                payload.body = body;
            } else {
                payload.bodyBase64 = bytesToBase64(body);
            }

            try {
                socket.send(JSON.stringify(payload));
            } catch (err) {
                finish(new ApiTransportError('WebSocket API send failed'));
            }
        };

        socket.onmessage = (event) => {
            let reply;
            try {
                reply = JSON.parse(event.data);
            } catch (err) {
                finish(new ApiTransportError('Malformed WebSocket API response'));
                return;
            }

            if (reply && reply.id !== undefined && reply.id !== null && String(reply.id) !== id) return;

            const contentType = String((reply && reply.contentType) || '');
            let data = null;
            if (reply && reply.json !== undefined) {
                data = reply.json;
            } else if (reply && typeof reply.body === 'string') {
                if (contentType.includes('application/json')) {
                    try {
                        data = JSON.parse(reply.body);
                    } catch (err) {
                        data = reply.body;
                    }
                } else {
                    data = reply.body;
                }
            }

            let bodyBytes = null;
            if (reply && typeof reply.bodyBase64 === 'string') {
                try {
                    bodyBytes = base64ToBytes(reply.bodyBase64);
                } catch (err) {
                    finish(new ApiTransportError('Malformed WebSocket API response'));
                    return;
                }
            }

            if (bodyBytes === null && (!data || typeof data !== 'object')) {
                data = { error: typeof data === 'string' ? data : 'Unknown server response' };
            }
            if (data === null) data = {};

            const status = Number(reply && reply.status) || (reply && reply.error ? 500 : 200);
            if (reply && reply.error && !data.error) {
                data.error = String(reply.error);
            }

            finish(null, { status, data, bodyBytes, contentType });
        };

        socket.onerror = () => finish(new ApiTransportError('WebSocket API connection failed'));
        socket.onclose = () => finish(new ApiTransportError('WebSocket API connection closed'));
    });
}

async function apiRequest(method, endpoint, options = {}) {
    if (!getApiWebSocketUrl()) {
        throw new ApiTransportError('WebSocket API is not available');
    }

    return requestOverWebSocket(method, endpoint, options);
}

async function postRequest(endpoint, payload, isProtected = false) {
    const headers = { 'Content-Type': 'application/json' };

    if (isProtected) {
        const token = getAuthToken();
        if (!token) {
            throw new Error("Authentication token missing for protected endpoint");
        }
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const { status, data } = await apiRequest('POST', endpoint, {
            headers,
            body: JSON.stringify(payload),
        });

        if (status < 200 || status >= 300) {
            if (status === 401 && isProtected) {
                clearAuthToken();
            }
            throw new Error((data && data.error) || `Server error: ${status}`);
        }

        return data;
    } catch (error) {
        console.error(`API Call Failed (${endpoint}):`, error);
        throw new Error(`Failed to communicate with server, ${error.message}`);
    }
}

async function getRequest(endpoint) {
    try {
        const { status, data } = await apiRequest('GET', endpoint);

        if (status < 200 || status >= 300) {
            throw new Error((data && data.error) || `Server error: ${status}`);
        }

        return data;
    } catch (error) {
        console.error(`API Call Failed (${endpoint}):`, error);
        throw new Error(`Failed to retrieve data, ${error.message}`);
    }
}

export async function register(username, password) {
    return postRequest('/api/register', { username, password });
}

export async function login(username, password) {
    const response = await postRequest('/api/login', { username, password });
    if (response.token) {
        saveAuthToken(response.token);
    }

    return response;
}

export async function logout() {
    try {
        const response = await postRequest('/api/logout', {}, true);
        clearAuthToken();
        return response;
    } catch (error) {
        clearAuthToken();
        throw error;
    }
}

export async function getUserInfo(username) {
    return getRequest(`/api/user/${encodeURIComponent(username)}`);
}

export async function userExists(username) {
    try {
        const { status, data } = await apiRequest('GET', `/api/user/${encodeURIComponent(username)}`);

        if (status === 200) {
            return true;
        }

        if (status === 404) {
            return false;
        }

        throw new Error((data && data.error) || `Server error: ${status}`);
    } catch (error) {
        throw new Error(`Failed to check user's existence, ${error.message}`);
    }
}

export function getSkinUrl(username) {
    return `${API_BASE_URL}/skin/${username}`;
}

export function getCapeUrl(username) {
    return `${API_BASE_URL}/cape/${username}`;
}

export function getSkinPath(username) {
    return `/skin/${encodeURIComponent(username)}`;
}

export function getCapePath(username, capeId) {
    const base = `/cape/${encodeURIComponent(username)}`;
    return capeId ? `${base}?id=${encodeURIComponent(capeId)}` : base;
}

export async function fetchApiBlob(path) {
    const { status, data, bodyBytes, contentType } = await apiRequest('GET', path, { timeoutMs: 30000 });

    if (status < 200 || status >= 300 || !bodyBytes) {
        const error = new Error((data && data.error) || `Server error: ${status}`);
        error.status = status;
        throw error;
    }

    return new Blob([bodyBytes], { type: contentType || 'application/octet-stream' });
}

const MAX_CACHED_IMAGES = 64;
const imageUrlCache = new Map();

function revokeImageUrl(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch (err) {  }
    }
}

export function invalidateApiImage(path) {
    const key = String(path);
    const cached = imageUrlCache.get(key);
    if (!cached) return;

    imageUrlCache.delete(key);
    cached.then((url) => {
        if (![...imageUrlCache.values()].includes(cached)) revokeImageUrl(url);
    }, () => {  });
}

export function loadApiImageUrl(path) {
    const key = String(path);
    const cached = imageUrlCache.get(key);
    if (cached) return cached;

    const pending = fetchApiBlob(key).then((blob) => URL.createObjectURL(blob));
    imageUrlCache.set(key, pending);

    if (imageUrlCache.size > MAX_CACHED_IMAGES) {
        for (const [oldKey, oldValue] of imageUrlCache) {
            if (oldKey === key) continue;
            imageUrlCache.delete(oldKey);
            oldValue.then(revokeImageUrl, () => {  });
            break;
        }
    }

    pending.catch(() => {
        if (imageUrlCache.get(key) === pending) imageUrlCache.delete(key);
    });

    return pending;
}

export function getSkinImageUrl(username) {
    return loadApiImageUrl(getSkinPath(username));
}

export function getCapeImageUrl(username, capeId) {
    return loadApiImageUrl(getCapePath(username, capeId));
}

async function getProtectedRequest(endpoint) {
    const token = getAuthToken();
    if (!token) {
        throw new Error('You must be signed in.');
    }

    const { status, data } = await apiRequest('GET', endpoint, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (status === 401) {
        clearAuthToken();
        throw new Error('Your session expired. Sign in again.');
    }

    if (status < 200 || status >= 300) {
        throw new Error((data && data.error) || `Server error: ${status}`);
    }

    return data;
}

export async function getCapes() {
    return getProtectedRequest('/api/capes');
}

export async function selectCape(capeId) {
    return postRequest('/api/cape/choice', { capeId: capeId === undefined ? null : capeId }, true);
}

export async function redeemCapeCode(code) {
    return postRequest('/api/capes/redeem', { code }, true);
}

export function getCapeUrlForId(username, capeId) {
    if (!capeId || capeId === 'common') {
        return `${API_BASE_URL}/cape/${username}?id=common`;
    }
    return `${API_BASE_URL}/cape/${username}?id=${encodeURIComponent(capeId)}`;
}





function buildSkinMultipart(fileBytes, boundary) {
    const encoder = new TextEncoder();
    const head = encoder.encode(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="skin.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);

    const body = new Uint8Array(head.length + fileBytes.length + tail.length);
    body.set(head, 0);
    body.set(fileBytes, head.length);
    body.set(tail, head.length + fileBytes.length);
    return body;
}

export function uploadSkinForUser(username) {
    return new Promise((resolve, reject) => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png';
        fileInput.style.display = 'none';

        const token = getAuthToken();
        if (!token) {
            return reject(new Error("You must be logged in to upload a skin"));
        }

        fileInput.onchange = async (event) => {
            const file = event.target.files[0];

            if (!file) {
                fileInput.remove();
                return reject(new Error("No file selected"));
            }

            try {
                const fileBytes = new Uint8Array(await file.arrayBuffer());
                const boundary = `----breakmine${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

                const { status, data } = await apiRequest('POST', '/api/upload_skin', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    },
                    body: buildSkinMultipart(fileBytes, boundary),
                    timeoutMs: 45000,
                });

                if (status === 401) {
                    clearAuthToken();
                }

                if (status < 200 || status >= 300) {
                    return reject(new Error((data && data.error) || `Server-side error: ${status}`));
                }

                resolve(data);
            } catch (error) {
                reject(new Error(`Failed to upload skin, ${error.message}`));
            } finally {
                fileInput.remove();
            }
        };

        let isCanceled = true;
        fileInput.onclick = () => { isCanceled = false; };

        fileInput.click();

        setTimeout(() => {
            if (isCanceled && fileInput.parentElement) {
                reject(new Error("File upload cancelled by user"));
                fileInput.remove();
            }
        }, 1000);
    });
}
