"use client";
import { useState, useEffect, useRef, useMemo } from "react";

// On ajoute un champ 'recipient' pour savoir à qui s'adresse le message
type Message = { sender: string; recipient: string; content: string; type: string; timestamp: string };

// const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_EMAIL = "prof@skeuly.com";

export default function ChatInterface({ userEmail }: { userEmail: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Déconnecté");
  
  const isAdmin = userEmail === ADMIN_EMAIL;
  const [activeContact, setActiveContact] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    // On utilise une variable locale pour être sûr de manipuler la bonne instance
    const socket = new WebSocket(`ws://localhost:8080/ws?token=${token}`);
    ws.current = socket;
    
    socket.onopen = () => setStatus("Connecté 🟢");
    socket.onclose = () => setStatus("Déconnecté 🔴");
    
    socket.onmessage = (event) => {
      const newMsg: Message = JSON.parse(event.data);
      setMessages((prev) => [...prev, newMsg]);
    };

    return () => {
      // Correction du React Strict Mode :
      // Si la connexion est encore en cours d'ouverture, on attend qu'elle s'ouvre pour la fermer
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      } else {
        socket.close();
      }
    };
  }, []);

  // Extraire la liste unique des clients qui ont envoyé un message (pour l'admin)
  const contacts = useMemo(() => {
    const uniqueSenders = new Set(
      messages
        .filter((m) => m.sender !== ADMIN_EMAIL)
        .map((m) => m.sender)
    );
    return Array.from(uniqueSenders);
  }, [messages]);

  // Sélectionner automatiquement le premier contact s'il y en a un et qu'aucun n'est sélectionné
  useEffect(() => {
    if (isAdmin && contacts.length > 0 && !activeContact) {
      setActiveContact(contacts[0]);
    }
  }, [contacts, isAdmin, activeContact]);

  // Filtrer les messages à afficher dans la fenêtre courante
  const displayedMessages = messages.filter((m) => {
    if (isAdmin) {
      // L'admin ne voit que la conversation avec le contact sélectionné
      return (m.sender === activeContact && m.recipient === ADMIN_EMAIL) || 
             (m.sender === ADMIN_EMAIL && m.recipient === activeContact);
    }
    // Le client ne voit que ses échanges avec l'admin
    return (m.sender === userEmail && m.recipient === ADMIN_EMAIL) || 
           (m.sender === ADMIN_EMAIL && m.recipient === userEmail);
  });

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Sécurité : l'admin doit avoir sélectionné un contact pour répondre
    if (isAdmin && !activeContact) return;

    if (ws.current && ws.current.readyState === WebSocket.OPEN && input.trim() !== "") {
      const targetRecipient = isAdmin ? activeContact! : ADMIN_EMAIL;

      ws.current.send(JSON.stringify({
        sender: userEmail,
        recipient: targetRecipient,
        content: input,
        type: "text",
        timestamp: new Date().toISOString()
      }));
      setInput("");
    }
  };

  return (
    <div className="h-full flex flex-col max-w-6xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">
          {isAdmin ? "Support Clients" : "Contacter le professeur"}
        </h1>
        <span className="text-sm font-mono bg-gray-800 border border-gray-700 px-3 py-1 rounded-full">
          {status}
        </span>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* PANNEAU LATÉRAL : Liste des contacts (Visible uniquement pour l'admin) */}
        {isAdmin && (
          <div className="w-1/3 bg-gray-800 border border-gray-700 rounded-xl flex flex-col overflow-hidden">
            <div className="p-4 bg-gray-900/50 border-b border-gray-700 font-bold text-gray-300">
              Conversations
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
              {contacts.length === 0 ? (
                <p className="text-gray-500 text-sm text-center mt-4 italic">Aucun message reçu</p>
              ) : (
                contacts.map((contact) => (
                  <button
                    key={contact}
                    onClick={() => setActiveContact(contact)}
                    className={`text-left px-4 py-3 rounded-lg truncate transition-colors ${
                      activeContact === contact 
                        ? "bg-blue-600 text-white" 
                        : "text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {contact}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ZONE DE CHAT PRINCIPALE */}
        <div className={`flex flex-col bg-gray-800 border border-gray-700 rounded-xl overflow-hidden ${isAdmin ? 'w-2/3' : 'w-full max-w-4xl mx-auto'}`}>
          
          {/* En-tête de la zone de chat pour l'admin */}
          {isAdmin && (
            <div className="p-4 bg-gray-900/50 border-b border-gray-700 font-bold text-gray-300">
              {activeContact ? `En discussion avec : ${activeContact}` : "Sélectionnez un client"}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
            {displayedMessages.length === 0 ? (
              <p className="text-gray-400 text-center italic mt-auto mb-auto">
                {isAdmin && !activeContact 
                  ? "En attente de sélection..." 
                  : "Aucun message. Démarre la conversation !"}
              </p>
            ) : (
              displayedMessages.map((msg, index) => {
                const isMe = msg.sender === userEmail;
                return (
                  <div key={index} className={`px-4 py-2 rounded-lg max-w-[75%] shadow ${isMe ? 'bg-blue-600 self-end' : 'bg-gray-700 self-start'}`}>
                    {!isMe && <div className="text-xs text-gray-400 mb-1 font-semibold">{msg.sender}</div>}
                    <div className="break-words">{msg.content}</div>
                    <div className={`text-[10px] text-right mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Formulaire d'envoi */}
          <form onSubmit={sendMessage} className="bg-gray-800 border-t border-gray-700 p-4 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isAdmin && !activeContact}
              className="flex-1 bg-gray-900 border border-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder={isAdmin && !activeContact ? "Sélectionnez un contact pour répondre" : "Écrivez un message..."}
            />
            <button
              type="submit"
              disabled={status !== "Connecté 🟢" || (isAdmin && !activeContact)}
              className="bg-blue-600 hover:bg-blue-500 font-bold py-3 px-6 rounded-lg disabled:opacity-50 transition-colors"
            >
              Envoyer
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}