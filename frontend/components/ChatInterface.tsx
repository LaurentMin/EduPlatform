"use client";
import { useState, useEffect, useRef } from "react";

type Message = { sender: string; content: string; type: string; timestamp: string };

export default function ChatInterface({ userEmail }: { userEmail: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Déconnecté");
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
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
  }, []);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (ws.current && ws.current.readyState === WebSocket.OPEN && input.trim() !== "") {
      ws.current.send(JSON.stringify({
        sender: userEmail,
        content: input,
        type: "text",
        timestamp: new Date().toISOString()
      }));
      setInput("");
    }
  };

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Discussion en direct</h1>
        <span className="text-sm font-mono bg-gray-800 border border-gray-700 px-3 py-1 rounded-full">
          {status}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-800 border border-gray-700 rounded-t-xl p-6 flex flex-col gap-3">
        {messages.length === 0 ? (
          <p className="text-gray-400 text-center italic mt-auto mb-auto">Aucun message. Démarre la conversation !</p>
        ) : (
          messages.map((msg, index) => {
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

      <form onSubmit={sendMessage} className="bg-gray-800 border-x border-b border-gray-700 p-4 rounded-b-xl flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-gray-900 border border-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Écrivez un message..."
        />
        <button
          type="submit"
          disabled={status !== "Connecté 🟢"}
          className="bg-blue-600 hover:bg-blue-500 font-bold py-3 px-6 rounded-lg disabled:opacity-50 transition-colors"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}