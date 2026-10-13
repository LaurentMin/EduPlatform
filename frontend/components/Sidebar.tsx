"use client";

type SidebarProps = {
  userEmail: string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
};

export default function Sidebar({ userEmail, activeTab, setActiveTab, onLogout }: SidebarProps) {
  return (
    <aside className="w-64 bg-gray-800 p-6 flex flex-col border-r border-gray-700">
      <div className="mb-10">
        <h2 className="text-2xl font-bold text-blue-400">EduPlatform</h2>
        <p className="text-xs text-gray-400 mt-1 truncate">{userEmail}</p>
      </div>

      <nav className="flex flex-col gap-2 flex-1">
        <button 
          onClick={() => setActiveTab("calendar")}
          className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === "calendar" ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-700 hover:text-white"}`}
        >
          📅 Réservations
        </button>
        
        <button 
          onClick={() => setActiveTab("courses")}
          className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === "courses" ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-700 hover:text-white"}`}
        >
          📚 Mes Cours
        </button>

        <button 
          onClick={() => setActiveTab("chat")}
          className={`text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === "chat" ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-700 hover:text-white"}`}
        >
          💬 Messagerie
        </button>
      </nav>

      <button onClick={onLogout} className="mt-auto text-left px-4 py-3 text-red-400 hover:bg-gray-700 rounded-lg transition-colors">
        🚪 Déconnexion
      </button>
    </aside>
  );
}