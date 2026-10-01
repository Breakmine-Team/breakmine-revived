import { deflate, inflate } from "../../lib/pako.js";

// `window` does not exist in a Web Worker; both IndexedDB and localStorage are
// available as globals there instead. These helpers work everywhere.
function getIndexedDB() {
    return (typeof indexedDB !== 'undefined' && indexedDB) ? indexedDB : null;
}

function getLocalStorage() {
    return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null;
}

function toBase64(u8) {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < u8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function fromBase64(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        u8[i] = bin.charCodeAt(i);
    }
    return u8;
}

export default class FileSystem {
    constructor(dbName = 'BrowserFileStoreDB', storeName = 'text_files') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
        this.localStoragePrefix = 'bts-';
        if (!getIndexedDB()) {
            console.warn("No IndexedDB support! Using LocalStorage.");
        }
    }

    async _getDb() {
        if (!getIndexedDB()) return null;
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = getIndexedDB().open(this.dbName, 1);

            request.onerror = (event) => {
                console.error("IndexedDB error: ", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore(this.storeName, { keyPath: 'fileName' });
            };
        });
    }

    async _getTransactionStore(mode) {
        const db = await this._getDb();
        if (!db) return null;
        const tx = db.transaction(this.storeName, mode);
        return tx.objectStore(this.storeName);
    }

    async fileExists(filename) {
        const lsKey = this.localStoragePrefix + filename;

        const ls = getLocalStorage();
        if (ls && ls.getItem(lsKey) !== null) {
            return true;
        }

        const store = await this._getTransactionStore('readonly');
        if (store) {
            return new Promise((resolve, reject) => {
                const request = store.count(filename); 

                request.onsuccess = (event) => {
                    resolve(event.target.result > 0); 
                };
                request.onerror = (event) => {
                    console.error("IndexedDB count error:", event.target.error);
                    resolve(false); 
                };
            });
        }

        return false;
    }

    async getFileSize(filename) {
        const lsKey = this.localStoragePrefix + filename;
        let fileData = null;

        const ls = getLocalStorage();
        fileData = ls ? ls.getItem(lsKey) : null;
        
        if (fileData !== null) {
            return fileData.length;
        }

        const store = await this._getTransactionStore('readonly');
        if (store) {
            fileData = await new Promise((resolve, reject) => {
                const request = store.get(filename);
                request.onsuccess = (event) => {
                    const record = event.target.result;
                    resolve(record ? record.data.length : null);
                };
                request.onerror = (event) => {
                    console.error("IndexedDB get error during size check:", event.target.error);
                    reject(event.target.error);
                };
            });
        }
        
        return fileData; 
    }

    _formatSize(bytes) {
        if (bytes === null || bytes === undefined) return null;
        if (bytes === 0) return '0B';

        const units = ['B', 'kB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        
        let size = bytes / Math.pow(1024, i);

        if (i > 0 && size < 10) {
            return size.toFixed(1) + units[i];
        }

        return Math.round(size) + units[i];
    }
    
    async getFileSizeHumanReadable(filename) {
        const bytes = await this.getFileSize(filename);
        if (bytes === null) {
            return null;
        }
        return this._formatSize(bytes);
    }

    async saveFile(text, filename) {
        if (typeof text !== 'string') {
            return Promise.reject(new Error("Data must be a string"));
        }

        const textEncoder = new TextEncoder();
        const originalData = textEncoder.encode(text);
        
        const compressedData = deflate(originalData); 
        
        const base64Text = toBase64(compressedData); 

        const lsKey = this.localStoragePrefix + filename;

        const store = await this._getTransactionStore('readwrite');
        if (store) {
            // Primary: save to IndexedDB
            return new Promise((resolve, reject) => {
                const fileRecord = {
                    fileName: filename,
                    data: base64Text,
                    timestamp: Date.now()
                };
                const request = store.put(fileRecord);
                
                request.onsuccess = () => {
                    console.log(`Saved '${filename}' in IndexedDB.`);
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("IndexedDB save error:", event.target.error);
                    reject(event.target.error);
                };
            });
        }

        // Fallback: save to LocalStorage
        const ls = getLocalStorage();
        try {
            if (!ls) throw new Error('localStorage unavailable');
            ls.setItem(lsKey, base64Text);

            await this._deleteFileFromIndexedDB(filename);
            return;

        } catch (e) {
            console.warn(`IndexedDB save failed, using LocalStorage for '${filename}': ${e.message}`);

            if (ls) ls.removeItem(lsKey);

            return new Promise((resolve, reject) => {
                const fileRecord = {
                    fileName: filename,
                    data: base64Text,
                    timestamp: Date.now()
                };
                const request = store.put(fileRecord);
                
                request.onsuccess = () => {
                    console.log(`Saved '${filename}' in IndexedDB.`);
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("IndexedDB save error:", event.target.error);
                    reject(event.target.error);
                };
            });
        }
    }

    async saveBinaryFile(data, filename) {
        // data can be Uint8Array, ArrayBuffer, or base64 string
        let base64Data;
        
        if (typeof data === 'string') {
            // Assume it's already base64
            base64Data = data;
        } else if (data instanceof Uint8Array) {
            base64Data = toBase64(data);
        } else if (data instanceof ArrayBuffer) {
            base64Data = toBase64(new Uint8Array(data));
        } else {
            return Promise.reject(new Error("Data must be string, Uint8Array, or ArrayBuffer"));
        }

        const lsKey = this.localStoragePrefix + filename;

        const store = await this._getTransactionStore('readwrite');
        if (store) {
            // Primary: save to IndexedDB
            return new Promise((resolve, reject) => {
                const fileRecord = {
                    fileName: filename,
                    data: base64Data,
                    timestamp: Date.now()
                };
                const request = store.put(fileRecord);
                
                request.onsuccess = () => {
                    console.log(`Saved binary file '${filename}' in IndexedDB.`);
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("IndexedDB save error:", event.target.error);
                    reject(event.target.error);
                };
            });
        }

        // Fallback: save to LocalStorage
        const ls = getLocalStorage();
        try {
            if (!ls) throw new Error('localStorage unavailable');
            ls.setItem(lsKey, base64Data);
            await this._deleteFileFromIndexedDB(filename);
            return;

        } catch (e) {
            console.warn(`IndexedDB save failed, using LocalStorage for '${filename}': ${e.message}`);

            if (ls) ls.removeItem(lsKey);

            return new Promise((resolve, reject) => {
                const fileRecord = {
                    fileName: filename,
                    data: base64Data,
                    timestamp: Date.now()
                };
                const request = store.put(fileRecord);
                
                request.onsuccess = () => {
                    console.log(`Saved binary file '${filename}' in IndexedDB.`);
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("IndexedDB save error:", event.target.error);
                    reject(event.target.error);
                };
            });
        }
    }

    async loadFile(filename) {
        const lsKey = this.localStoragePrefix + filename;
        let fileData = null;

        const ls = getLocalStorage();
        fileData = ls ? ls.getItem(lsKey) : null;

        if (fileData === null) {
            const store = await this._getTransactionStore('readonly');
            if (store) {
                fileData = await new Promise((resolve, reject) => {
                    const request = store.get(filename);
                    request.onsuccess = (event) => {
                        const record = event.target.result;
                        resolve(record ? record.data : null);
                    };
                    request.onerror = (event) => reject(event.target.error);
                });
            }
        }

        if (fileData === null) {
            return null; 
        }

        let decompressedText = null;

        try {
            const compressedU8Array = fromBase64(fileData);

            const inflatedData = inflate(compressedU8Array, { to: 'string' });
            decompressedText = inflatedData;

        } catch (error) {
            console.warn(`Decompression failed for '${filename}', assuming uncompressed text (${error.message || error})`);
            decompressedText = fileData;
        }

        return decompressedText;
    }

    async loadBinaryFile(filename) {
        const lsKey = this.localStoragePrefix + filename;
        let fileData = null;

        const ls = getLocalStorage();
        fileData = ls ? ls.getItem(lsKey) : null;

        if (fileData === null) {
            const store = await this._getTransactionStore('readonly');
            if (store) {
                fileData = await new Promise((resolve, reject) => {
                    const request = store.get(filename);
                    request.onsuccess = (event) => {
                        const record = event.target.result;
                        resolve(record ? record.data : null);
                    };
                    request.onerror = (event) => reject(event.target.error);
                });
            }
        }

        if (fileData === null) {
            return null; 
        }

        // Return as Uint8Array
        return fromBase64(fileData);
    }

    async deleteFile(filename) {
        const ls = getLocalStorage();
        if (ls) ls.removeItem(this.localStoragePrefix + filename);
        await this._deleteFileFromIndexedDB(filename);
    }

    async listDir(dir = '') {
        let prefix = dir.trim();
        if (prefix.length > 0 && !prefix.endsWith('/')) {
            prefix += '/';
        }

        const files = new Set();
        
        this._listDirLocalStorage(prefix, files);
        await this._listDirIndexedDB(prefix, files);
        return Array.from(files);
    }

    _listDirLocalStorage(prefix, filesSet) {
        const ls = getLocalStorage();
        if (!ls) return;

        const lsPrefix = this.localStoragePrefix;

        for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);

            if (key && key.startsWith(lsPrefix)) {
                const fileName = key.substring(lsPrefix.length);
                if (fileName.startsWith(prefix)) {
                    filesSet.add(fileName);
                }
            }
        }
    }

    async _listDirIndexedDB(prefix, filesSet) {
        const store = await this._getTransactionStore('readonly');
        if (!store) {
            console.warn("IndexedDB not available for directory listing");
            return;
        }

        return new Promise((resolve, reject) => {
            const request = store.openCursor(); 

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const fileName = cursor.key;
                    if (fileName.startsWith(prefix)) {
                        filesSet.add(fileName);
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };

            request.onerror = (event) => {
                console.error("IndexedDB cursor error during listDir:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    async _deleteFileFromIndexedDB(filename) {
        const store = await this._getTransactionStore('readwrite');
        if (!store) return;
        
        return new Promise((resolve, reject) => {
            const request = store.delete(filename);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }
}