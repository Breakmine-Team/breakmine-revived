const TOKEN_STORAGE_KEY = 'authToken';

export function isLocalNetwork() {
    const hostname = window.location.hostname;

    // 1. Instantly validate standard local text hostnames
    if (hostname === 'localhost' || hostname.endsWith('.local')) {
        return true;
    }

    // 2. Regular expressions for IPv4 Private & Loopback Ranges
    const ipV4Loopback = /^127\./;
    const ipV4PrivateA = /^10\./;
    const ipV4PrivateB = /^172\.(1[6-9]|2[0-9]|3[0-1])\./;
    const ipV4PrivateC = /^192\.168\./;
    const ipV4LinkLocal = /^169\.254\./;

    // 3. Regular expressions for IPv6 Private & Loopback Ranges
    const ipV6Loopback = /^::1$/;
    const ipV6UniqueLocal = /^[fF][cCdD]/; // fc00::/7
    const ipV6LinkLocal = /^[fF][eE][89aAbB]/; // fe80::/10

    // Strip IPv6 bracket notation if present (e.g. [::1] -> ::1)
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

export function setApiBaseUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return;
    API_BASE_URL = url.startsWith('http://') || url.startsWith('https://') ? url : 'https://' + url;
}

export function getApiBaseUrl() {
    return API_BASE_URL;
}


export class AuthLibInfo {
    static VERSION = "1.0.0";
    static NAME = "AuthLib";
    
    constructor() {
        //
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

async function postRequest(endpoint, payload, isProtected = false) {
    const url = API_BASE_URL + endpoint;
    const headers = { 'Content-Type': 'application/json' };
    
    if (isProtected) {
        const token = getAuthToken();
        if (!token) {
            throw new Error("Authentication token missing for protected endpoint");
        }
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401 && isProtected) {
                clearAuthToken();
            }
            throw new Error(data.error || `Server error: ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error(`API Call Failed (${endpoint}):`, error);
        throw new Error(`Failed to communicate with server, ${error.message}`);
    }
}

async function getRequest(endpoint) {
    const url = API_BASE_URL + endpoint;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
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
    return getRequest(`/api/user/${username}`);
}

export async function userExists(username) {
    const url = API_BASE_URL + `/api/user/${username}`;

    try {
        const response = await fetch(url);

        if (response.status === 200) {
            return true;
        }

        if (response.status === 404) {
            return false;
        }

        const data = await response.json().catch(() => ({ error: 'Unknown server response' }));
        throw new Error(data.error || `Server error: ${response.status}`);

    } catch (error) {
        throw new Error(`Failed to check user's existence, ${error.message}`);
    }
}

export function getSkinUrl(username) {
    return `${API_BASE_URL}/skin/${username}`;
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

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch(`${API_BASE_URL}/api/upload_skin`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                const data = await response.json();

                if (!response.ok) {
                    if (response.status === 401) {
                        clearAuthToken();
                    }
                    return reject(new Error(data.error || `Server-side error: ${response.status}`));
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