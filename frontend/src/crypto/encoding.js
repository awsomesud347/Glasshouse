// converts a base64 string to a Uint8Array (raw bytes)
export function base64ToBytes(base64) {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

// converts a Uint8Array (raw bytes) to a base64 string
export function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes))
}

// converts a hex string to a Uint8Array
export function hexToBytes(hex) {
    return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
}

// converts a Uint8Array to a hex string
export function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}