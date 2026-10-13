"use client";
import { useState } from "react";

export default function AuthForm({ onLoginSuccess }: { onLoginSuccess: (email: string) => void }) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const endpoint = isLoginMode ? "/api/login" : "/api/register";
    
    try {
      const res = await fetch(`http://localhost:8080${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setAuthError(await res.text() || "Une erreur est survenue");
        return;
      }

      if (isLoginMode) {
        const data = await res.json();
        localStorage.setItem("token", data.token);
        localStorage.setItem("userEmail", email);
        onLoginSuccess(email);
      } else {
        setIsLoginMode(true);
        setAuthError("Compte créé ! Connecte-toi maintenant. ✅");
      }
    } catch (err) {
      setAuthError("Impossible de joindre le serveur");
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center font-sans">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-6">
          {isLoginMode ? "Espace Client" : "Créer un compte"}
        </h1>
        {authError && (
          <div className={`p-3 rounded mb-4 text-sm ${authError.includes('✅') ? 'bg-green-600' : 'bg-red-500'}`}>
            {authError}
          </div>
        )}
        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-gray-700 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Email" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-gray-700 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Mot de passe" />
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 font-bold py-2 rounded-lg transition-colors">
            {isLoginMode ? "Se connecter" : "S'inscrire"}
          </button>
        </form>
        <p className="text-center text-sm text-gray-400 mt-6">
          <button onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(""); }} className="text-blue-400 hover:underline">
            {isLoginMode ? "Créer un compte" : "Déjà un compte ? Se connecter"}
          </button>
        </p>
      </div>
    </div>
  );
}