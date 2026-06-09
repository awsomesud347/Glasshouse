import { bytesToBase64, base64ToBytes } from './encoding.js'

export async function encryptVault(vaultObject, encKey) {
    // generate a fresh random IV every single time
    // never reuse an IV with AES-GCM — reuse breaks security completely
    const iv = crypto.getRandomValues(new Uint8Array(12))  // 96 bits

    // serialize vault object to JSON string, then encode to bytes
    const plaintext = new TextEncoder().encode(JSON.stringify(vaultObject))

    // encrypt — AES-256-GCM gives you confidentiality + integrity
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        encKey,
        plaintext
    )

    // return both as base64 strings — ready to send to backend
    return {
        vault_blob: bytesToBase64(new Uint8Array(ciphertext)),
        iv: bytesToBase64(iv)
    }
}

export async function decryptVault(vaultBlob, ivString, encKey) {
    // convert base64 strings back to raw bytes
    const ciphertext = base64ToBytes(vaultBlob)
    const iv = base64ToBytes(ivString)

    // decrypt — will throw if ciphertext was tampered with
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        encKey,
        ciphertext
    )

    // decode bytes back to string, parse JSON back to object
    return JSON.parse(new TextDecoder().decode(plaintext))
}