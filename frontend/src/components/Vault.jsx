import { useState } from "react"
import { encryptVault } from "../crypto/vault.js"
import { getEncKey, getVersion, setVersion, clearSession } from "../store/session.js"
import { api } from "../api/client.js"

export default function Vault({ vault, onVaultUpdate, onLogout }) {
    const [entries, setEntries] = useState(vault.entries)
    const [website, setWebsite] = useState("")
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)
    const [visiblePasswords, setVisiblePasswords] = useState({})
    const [copied, setCopied] = useState(null)

    async function saveVault(newEntries) {
        const encKey = getEncKey()
        const version = getVersion()

        const { vault_blob, iv } = await encryptVault({ entries: newEntries }, encKey)
        const { version: newVersion } = await api.updateVault(vault_blob, iv, version)
        setVersion(newVersion)
        return newVersion
    }

    async function handleAddEntry() {
        setError(null)
        if (!website || !username || !password) {
            setError("All fields are required")
            return
        }
        setLoading(true)
        try {
            const newEntry = {
                id: crypto.randomUUID(),
                website,
                username,
                password,
                created_at: new Date().toISOString()
            }
            const newEntries = [...entries, newEntry]
            await saveVault(newEntries)
            setEntries(newEntries)
            setWebsite("")
            setUsername("")
            setPassword("")
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    async function handleDeleteEntry(id) {
        setLoading(true)
        try {
            const newEntries = entries.filter(e => e.id !== id)
            await saveVault(newEntries)
            setEntries(newEntries)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    async function handleExport() {
        const data = await api.exportVault()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "vault-export.json"
        a.click()
        URL.revokeObjectURL(url)
    }

    async function handleDeleteAccount() {
        if (!confirm("Permanently delete your account and all data? This cannot be undone.")) return
        await api.deleteAccount()
        clearSession()
        onLogout()
    }

    function handleLogout() {
        clearSession()
        onLogout()
    }

    function togglePassword(id) {
        setVisiblePasswords(prev => ({ ...prev, [id]: !prev[id] }))
    }

    async function copyToClipboard(text, id) {
        await navigator.clipboard.writeText(text)
        setCopied(id)
        setTimeout(() => setCopied(null), 2000)
    }

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h1 style={styles.title}>Your Vault</h1>
                <div style={styles.headerActions}>
                    <button style={styles.secondaryButton} onClick={handleExport}>
                        Export
                    </button>
                    <button style={styles.dangerButton} onClick={handleDeleteAccount}>
                        Delete Account
                    </button>
                    <button style={styles.secondaryButton} onClick={handleLogout}>
                        Lock
                    </button>
                </div>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            {/* add entry form */}
            <div style={styles.addForm}>
                <h2 style={styles.sectionTitle}>Add Entry</h2>
                <div style={styles.formRow}>
                    <input
                        style={styles.input}
                        placeholder="Website"
                        value={website}
                        onChange={e => setWebsite(e.target.value)}
                    />
                    <input
                        style={styles.input}
                        placeholder="Username / Email"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                    />
                    <input
                        style={styles.input}
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                    <button
                        style={loading ? styles.buttonDisabled : styles.button}
                        onClick={handleAddEntry}
                        disabled={loading}
                    >
                        {loading ? "Saving..." : "Add"}
                    </button>
                </div>
            </div>

            {/* entries list */}
            <div style={styles.entriesList}>
                <h2 style={styles.sectionTitle}>
                    {entries.length === 0 ? "No entries yet" : `${entries.length} entries`}
                </h2>
                {entries.map(entry => (
                    <div key={entry.id} style={styles.entryCard}>
                        <div style={styles.entryHeader}>
                            <span style={styles.entryWebsite}>{entry.website}</span>
                            <button
                                style={styles.deleteButton}
                                onClick={() => handleDeleteEntry(entry.id)}
                            >
                                Delete
                            </button>
                        </div>
                        <div style={styles.entryRow}>
                            <span style={styles.entryLabel}>Username / Email</span>
                            <span style={styles.entryValue}>{entry.username}</span>
                            <button
                                style={styles.copyButton}
                                onClick={() => copyToClipboard(entry.username, `u-${entry.id}`)}
                            >
                                {copied === `u-${entry.id}` ? "Copied!" : "Copy"}
                            </button>
                        </div>
                        <div style={styles.entryRow}>
                            <span style={styles.entryLabel}>Password</span>
                            <span style={styles.entryValue}>
                                {visiblePasswords[entry.id] ? entry.password : "••••••••••••"}
                            </span>
                            <button
                                style={styles.copyButton}
                                onClick={() => togglePassword(entry.id)}
                            >
                                {visiblePasswords[entry.id] ? "Hide" : "Show"}
                            </button>
                            <button
                                style={styles.copyButton}
                                onClick={() => copyToClipboard(entry.password, `p-${entry.id}`)}
                            >
                                {copied === `p-${entry.id}` ? "Copied!" : "Copy"}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

const styles = {
    container: {
        minHeight: "100vh",
        backgroundColor: "#0f0f0f",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "800px",
        margin: "0 auto"
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "2rem"
    },
    headerActions: {
        display: "flex",
        gap: "0.75rem"
    },
    title: {
        color: "#ffffff",
        margin: 0,
        fontSize: "1.5rem",
        fontWeight: 600
    },
    sectionTitle: {
        color: "#aaa",
        fontSize: "0.875rem",
        fontWeight: 500,
        margin: "0 0 1rem 0",
        textTransform: "uppercase",
        letterSpacing: "0.05em"
    },
    addForm: {
        backgroundColor: "#1a1a1a",
        border: "1px solid #2a2a2a",
        borderRadius: "12px",
        padding: "1.5rem",
        marginBottom: "2rem"
    },
    formRow: {
        display: "flex",
        gap: "0.75rem",
        flexWrap: "wrap"
    },
    input: {
        flex: 1,
        minWidth: "150px",
        padding: "0.75rem 1rem",
        borderRadius: "8px",
        border: "1px solid #333",
        backgroundColor: "#111",
        color: "#fff",
        fontSize: "0.95rem",
        outline: "none",
        boxSizing: "border-box"
    },
    button: {
        padding: "0.75rem 1.5rem",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "#2563eb",
        color: "#fff",
        fontSize: "0.95rem",
        fontWeight: 600,
        cursor: "pointer"
    },
    buttonDisabled: {
        padding: "0.75rem 1.5rem",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "#1e3a8a",
        color: "#888",
        fontSize: "0.95rem",
        fontWeight: 600,
        cursor: "not-allowed"
    },
    secondaryButton: {
        padding: "0.5rem 1rem",
        borderRadius: "8px",
        border: "1px solid #333",
        backgroundColor: "transparent",
        color: "#aaa",
        fontSize: "0.875rem",
        cursor: "pointer"
    },
    dangerButton: {
        padding: "0.5rem 1rem",
        borderRadius: "8px",
        border: "1px solid #7f1d1d",
        backgroundColor: "transparent",
        color: "#fca5a5",
        fontSize: "0.875rem",
        cursor: "pointer"
    },
    deleteButton: {
        padding: "0.25rem 0.75rem",
        borderRadius: "6px",
        border: "1px solid #7f1d1d",
        backgroundColor: "transparent",
        color: "#fca5a5",
        fontSize: "0.8rem",
        cursor: "pointer"
    },
    copyButton: {
        padding: "0.25rem 0.75rem",
        borderRadius: "6px",
        border: "1px solid #333",
        backgroundColor: "transparent",
        color: "#aaa",
        fontSize: "0.8rem",
        cursor: "pointer"
    },
    entriesList: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
    },
    entryCard: {
        backgroundColor: "#1a1a1a",
        border: "1px solid #2a2a2a",
        borderRadius: "12px",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem"
    },
    entryHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
    },
    entryWebsite: {
        color: "#fff",
        fontWeight: 600,
        fontSize: "1rem"
    },
    entryRow: {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem"
    },
    entryLabel: {
        color: "#666",
        fontSize: "0.8rem",
        width: "120px",
        flexShrink: 0
    },
    entryValue: {
        color: "#ddd",
        fontSize: "0.9rem",
        flex: 1,
        fontFamily: "monospace"
    },
    error: {
        backgroundColor: "#2a1515",
        border: "1px solid #7f1d1d",
        color: "#fca5a5",
        padding: "0.75rem",
        borderRadius: "8px",
        fontSize: "0.875rem",
        marginBottom: "1rem"
    }
}