// module-level variables — live in memory only
// cleared automatically when tab closes or page refreshes
// never touch localStorage or sessionStorage

let _encKey = null
let _token = null
let _version = null

export function setSession(encKey, token, version) {
    _encKey = encKey
    _token = token
    _version = version
}

export function getEncKey() { return _encKey }
export function getToken() { return _token }
export function getVersion() { return _version }
export function setVersion(v) { _version = v }

export function isLoggedIn() { return _token !== null }

export function clearSession() {
    _encKey = null
    _token = null
    _version = null
}