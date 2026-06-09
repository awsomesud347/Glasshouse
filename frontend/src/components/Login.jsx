import { useState } from "react"
import { deriveKeys } from "../crypto/kdf.js"
import { decryptVault } from "../crypto/vault.js"
import { setSession } from "../store/session.js"
import { api } from "../api/client.js"

export default function Login({ onLogin, onSwitchToRegister }) {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)

    async function handleLogin() {
        setError(null)
        setLoading(true)
        try {
            // get salt for this email
            const { salt } = await api.getSalt(email)

            // derive enc_key and auth_key from master password + salt
            const { encKey, authKey } = await deriveKeys(password, salt)

            // authenticate with server — get token + encrypted vault
            const { token, vault_blob, iv, version } = await api.login(email, authKey)

            // decrypt vault locally using enc_key
            const vault = await decryptVault(vault_blob, iv, encKey)

            // store session in memory only
            setSession(encKey, token, version)

            // pass decrypted vault up to App
            onLogin(vault)
        } catch (e) {
            setError("Invalid email or master password")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.title}>Zero Knowledge Vault</h1>
                <p style={styles.subtitle}>Your master password never leaves your device.</p>

                {error && <div style={styles.error}>{error}</div>}

                <input
                    style={styles.input}
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                />
                <input
                    style={styles.input}
                    type="password"
                    placeholder="Master Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleLogin()}
                />

                <button
                    style={loading ? styles.buttonDisabled : styles.button}
                    onClick={handleLogin}
                    disabled={loading}
                >
                    {loading ? "Deriving keys..." : "Unlock Vault"}
                </button>

                <p style={styles.switch}>
                    No account?{" "}
                    <span style={styles.link} onClick={onSwitchToRegister}>
                        Create one
                    </span>
                </p>
            </div>
        </div>
    )
}

const styles = {
    container: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0f0f0f",
        fontFamily: "system-ui, sans-serif"
    },
    card: {
        backgroundColor: "#1a1a1a",
        padding: "2.5rem",
        borderRadius: "12px",
        width: "100%",
        maxWidth: "420px",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        border: "1px solid #2a2a2a"
    },
    title: {
        color: "#ffffff",
        margin: 0,
        fontSize: "1.5rem",
        fontWeight: 600
    },
    subtitle: {
        color: "#888",
        margin: 0,
        fontSize: "0.875rem"
    },
    input: {
        padding: "0.75rem 1rem",
        borderRadius: "8px",
        border: "1px solid #333",
        backgroundColor: "#111",
        color: "#fff",
        fontSize: "0.95rem",
        outline: "none",
        width: "100%",
        boxSizing: "border-box"
    },
    button: {
        padding: "0.75rem",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "#2563eb",
        color: "#fff",
        fontSize: "0.95rem",
        fontWeight: 600,
        cursor: "pointer",
        width: "100%"
    },
    buttonDisabled: {
        padding: "0.75rem",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "#1e3a8a",
        color: "#888",
        fontSize: "0.95rem",
        fontWeight: 600,
        cursor: "not-allowed",
        width: "100%"
    },
    error: {
        backgroundColor: "#2a1515",
        border: "1px solid #7f1d1d",
        color: "#fca5a5",
        padding: "0.75rem",
        borderRadius: "8px",
        fontSize: "0.875rem"
    },
    switch: {
        color: "#888",
        fontSize: "0.875rem",
        textAlign: "center",
        margin: 0
    },
    link: {
        color: "#2563eb",
        cursor: "pointer"
    }
}