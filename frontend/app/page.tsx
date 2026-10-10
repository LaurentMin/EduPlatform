"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Déconnecté");
  
  // useRef permet de conserver l'instance du WebSocket entre les rendus
  // sans déclencher de re-rendu inutile à chaque modification.
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // 1. Initialisation de la connexion vers le backend Go
    ws.current = new WebSocket("ws://localhost:8080/ws");

    // 2. Gestion des événements du cycle de vie du WebSocket
    ws.current.onopen = () => {
      setStatus("Connecté 🟢");
    };

    ws.current.onmessage = (event) => {
      // On ajoute le message reçu à la liste existante
      setMessages((prev) => [...prev, event.data]);
    };

    ws.current.onclose = () => {
      setStatus("Déconnecté 🔴");
    };

    // 3. Nettoyage à la destruction du composant
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (ws.current && ws.current.readyState === WebSocket.OPEN && input.trim() !== "") {
      ws.current.send(input);
      setInput(""); // On vide le champ après l'envoi
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center font-sans">
      <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Chat Test</h1>
          <span className="text-sm font-mono bg-gray-700 px-3 py-1 rounded-full">
            {status}
          </span>
        </div>

        {/* Zone d'affichage des messages */}
        <div className="h-64 overflow-y-auto bg-gray-700 rounded-lg p-4 mb-4 flex flex-col gap-2">
          {messages.length === 0 ? (
            <p className="text-gray-400 text-center italic mt-auto mb-auto">
              Aucun message. Dis bonjour !
            </p>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className="bg-blue-600 text-white px-4 py-2 rounded-lg self-end">
                {msg}
              </div>
            ))
          )}
        </div>

        {/* Formulaire d'envoi */}
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Tape ton message..."
          />
          <button
            type="submit"
            disabled={status !== "Connecté 🟢"}
            className="bg-blue-500 hover:bg-blue-400 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}