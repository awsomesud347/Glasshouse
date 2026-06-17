import { argon2id } from 'hash-wasm'
import { bytesToBase64 } from './encoding.js'

function hexToBytes(hex) {
    return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
}

export async function deriveKeys(masterPassword, saltHex) {
    const saltBytes = hexToBytes(saltHex)

    const rootKeyBytes = await argon2id({
        password: masterPassword,
        salt: saltBytes,
        parallelism: 1,
        iterations: 3,
        memorySize: 65536,
        hashLength: 64,
        outputType: 'binary'
    })

    const rootKey = await crypto.subtle.importKey(
        "raw",
        rootKeyBytes,
        "HKDF",
        false,
        ["deriveKey", "deriveBits"]
    )

    const encKey = await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(32),
            info: new TextEncoder().encode("enc")
        },
        rootKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    )

    const authKeyBits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(32),
            info: new TextEncoder().encode("auth")
        },
        rootKey,
        256
    )

    const authKey = bytesToBase64(new Uint8Array(authKeyBits))

    return { encKey, authKey }
}