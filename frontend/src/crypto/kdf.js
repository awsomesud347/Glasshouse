import argon2 from 'argon2-browser'
import { hexToBytes, bytesToBase64 } from './encoding.js'

export async function deriveKeys(masterPassword, saltHex) {
    // convert salt from hex string (what backend sends) to raw bytes
    const saltBytes = hexToBytes(saltHex)

    // same params as backend: memory 65536, iterations 3
    const result = await argon2.hash({
        pass: masterPassword,
        salt: saltBytes,
        type: argon2.ArgonType.Argon2id,
        mem: 65536,
        time: 3,
        parallelism: 1,
        hashLen: 64        // 64 bytes — enough for two 32-byte keys
    })

    // result.hash is a Uint8Array of 64 bytes
    // import it into WebCrypto as HKDF key material
    const rootKey = await crypto.subtle.importKey(
        "raw",
        result.hash,
        "HKDF",
        false,             // not extractable
        ["deriveKey", "deriveBits"]
    )

    // derive enc_key — stays in memory, never leaves browser
    const encKey = await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(32),   // 32 zero bytes
            info: new TextEncoder().encode("enc")  // context label
        },
        rootKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    )

    // derive auth_key — to send to the server
    const authKeyBits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(32),
            info: new TextEncoder().encode("auth")
        },
        rootKey,
        256                // 32 bytes
    )

    // convert auth_key to base64 so it can be sent in JSON
    const authKey = bytesToBase64(new Uint8Array(authKeyBits))

    return {
        encKey,            // CryptoKey object — used for encrypt/decrypt
        authKey            // base64 string — sent to backend once on login/register
    }
}