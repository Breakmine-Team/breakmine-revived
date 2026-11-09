/**
 * MediaEncryptor
 * A simple utility to encrypt and decrypt media files (like MP4) using AES-GCM 256.
 */
const MediaEncryptor = {
  /**
   * Derive a cryptographic key from a password string.
   */
  async _getKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  },

  /**
   * Encrypt an MP4 file ArrayBuffer using a password.
   * Returns a combined ArrayBuffer containing: Salt (16b) + IV (12b) + Encrypted Payload.
   */
  async encrypt(arrayBuffer, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this._getKey(password, salt);

    const encryptedContent = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      arrayBuffer
    );

    // Pack Salt (16B) + IV (12B) + Payload into a single ArrayBuffer
    const combined = new Uint8Array(
      salt.byteLength + iv.byteLength + encryptedContent.byteLength
    );
    combined.set(salt, 0);
    combined.set(iv, salt.byteLength);
    combined.set(new Uint8Array(encryptedContent), salt.byteLength + iv.byteLength);

    return combined.buffer;
  },

  /**
   * Decrypt an encrypted ArrayBuffer using a password.
   * Returns the original MP4 ArrayBuffer.
   */
  async decrypt(combinedBuffer, password) {
    const data = new Uint8Array(combinedBuffer);

    // Extract Salt, IV, and Payload
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const encryptedContent = data.slice(28);

    const key = await this._getKey(password, salt);

    try {
      const decryptedContent = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encryptedContent
      );
      return decryptedContent;
    } catch (err) {
      throw new Error("Decryption failed. Incorrect password or corrupted file.");
    }
  }
};