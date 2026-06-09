import { getToken } from '../store/session.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' }
    
    const token = getToken()
    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    })

    if (!res.ok) {
        const error = await res.json()
        throw new Error(error.detail || 'Request failed')
    }

    return res.json()
}

// auth endpoints
export const api = {
    getSalt: (email) => 
        request('GET', `/auth/salt?email=${encodeURIComponent(email)}`),
    
    registerInit: (email) => 
        request('POST', '/auth/register/init', { email }),
    
    registerComplete: (email, authKey, vaultBlob, iv, salt) =>
        request('POST', '/auth/register/complete', { 
            email, auth_key: authKey, vault_blob: vaultBlob, iv, salt 
        }),
    
    login: (email, authKey) =>
        request('POST', '/auth/login', { email, auth_key: authKey }),

    // vault endpoints
    getVault: () =>
        request('GET', '/vault/'),
    
    updateVault: (vaultBlob, iv, version) =>
        request('PUT', '/vault/', { vault_blob: vaultBlob, iv, version }),
    
    exportVault: () =>
        request('GET', '/vault/export'),
    
    deleteAccount: () =>
        request('DELETE', '/vault/account')
}