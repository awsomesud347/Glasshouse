import { useState } from "react"
import Login from "./components/Login.jsx"
import Register from "./components/Register.jsx"
import Vault from "./components/Vault.jsx"
import { isLoggedIn, clearSession } from "./store/session.js"

export default function App() {
    const [screen, setScreen] = useState("login")
    const [vault, setVault] = useState(null)

    function handleLogin(decryptedVault) {
        setVault(decryptedVault)
        setScreen("vault")
    }

    function handleLogout() {
        clearSession()
        setVault(null)
        setScreen("login")
    }

    if (screen === "register") {
        return (
            <Register
                onSwitchToLogin={() => setScreen("login")}
            />
        )
    }

    if (screen === "vault" && vault) {
        return (
            <Vault
                vault={vault}
                onVaultUpdate={setVault}
                onLogout={handleLogout}
            />
        )
    }

    return (
        <Login
            onLogin={handleLogin}
            onSwitchToRegister={() => setScreen("register")}
        />
    )
}