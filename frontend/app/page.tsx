"use client";

import { useState, useEffect, useRef } from "react";

type Message = { sender: string; content: string; type: string; timestamp: string };

export default function Home() {
  // --- ÉTATS POUR L'AUTHENTIFICATION ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true); // true = Login, false = Register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // --- ÉTATS POUR LE CHAT ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Déconnecté");
  const ws = useRef<WebSocket | null>(null);

  // Vérifier si un token existe déjà au chargement de la page
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  // Gérer la connexion au WebSocket UNIQUEMENT si authentifié
  useEffect(() => {
    if (!isAuthenticated) return;

    ws.current = new WebSocket("ws://localhost:8080/ws");
    ws.current.onopen = () => setStatus("Connecté 🟢");
    ws.current.onclose = () => setStatus("Déconnecté 🔴");
    
    ws.current.onmessage = (event) => {
      const newMsg: Message = JSON.parse(event.data);
      setMessages((prev) => [...prev, newMsg]);
    };

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [isAuthenticated]);

  // --- LOGIQUE D'AUTHENTIFICATION ---
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
        const errorText = await res.text();
        setAuthError(errorText || "Une erreur est survenue");
        return;
      }

      if (isLoginMode) {
        // En mode connexion, on récupère le token et on le sauvegarde
        const data = await res.json();
        localStorage.setItem("token", data.token);
        // On sauvegarde aussi l'email pour l'utiliser comme nom d'expéditeur
        localStorage.setItem("userEmail", email);
        setIsAuthenticated(true);
      } else {
        // En mode inscription, on bascule sur la vue de connexion
        setIsLoginMode(true);
        setAuthError("Compte créé ! Connecte-toi maintenant. ✅");
      }
    } catch (err) {
      setAuthError("Impossible de joindre le serveur");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userEmail");
    setIsAuthenticated(false);
    if (ws.current) ws.current.close();
  };

  // --- LOGIQUE DU CHAT ---
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (ws.current && ws.current.readyState === WebSocket.OPEN && input.trim() !== "") {
      const msgPayload = {
        sender: localStorage.getItem("userEmail") || "Utilisateur",
        content: input,
        type: "text",
        timestamp: new Date().toISOString()
      };
      ws.current.send(JSON.stringify(msgPayload));
      setInput("");
    }
  };

  // --- RENDU UI : FORMULAIRE D'AUTHENTIFICATION ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center font-sans">
        <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-8">
          <h1 className="text-3xl font-bold text-center mb-6">
            {isLoginMode ? "Connexion" : "Inscription"}
          </h1>
          
          {authError && (
            <div className={`p-3 rounded mb-4 text-sm ${authError.includes('✅') ? 'bg-green-600' : 'bg-red-500'}`}>
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-700 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="jean@exemple.com"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Mot de passe</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-700 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 font-bold py-2 px-4 rounded-lg mt-2 transition-colors"
            >
              {isLoginMode ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            {isLoginMode ? "Pas encore de compte ?" : "Déjà un compte ?"}
            <button
              onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(""); }}
              className="ml-2 text-blue-400 hover:underline"
            >
              {isLoginMode ? "S'inscrire" : "Se connecter"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // --- RENDU UI : LE CHAT (Si authentifié) ---
  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center font-sans">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Chat Live</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono bg-gray-700 px-3 py-1 rounded-full">
              {status}
            </span>
            <button onClick={handleLogout} className="text-sm text-red-400 hover:text-red-300">
              Déconnexion
            </button>
          </div>
        </div>

        <div className="h-64 overflow-y-auto bg-gray-700 rounded-lg p-4 mb-4 flex flex-col gap-2">
          {messages.map((msg, index) => (
            <div key={index} className="bg-blue-600 text-white px-4 py-2 rounded-lg self-end max-w-[80%] shadow">
              <div className="text-xs text-blue-200 mb-1 font-semibold">{msg.sender}</div>
              <div className="break-words">{msg.content}</div>
              <div className="text-[10px] text-blue-300 text-right mt-1">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-gray-700 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Tape ton message..."
          />
          <button
            type="submit"
            disabled={status !== "Connecté 🟢"}
            className="bg-blue-500 hover:bg-blue-400 font-bold py-2 px-4 rounded-lg disabled:opacity-50"
          >
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}