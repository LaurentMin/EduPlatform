"use client";

export default function CalendarView() {
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-3xl font-bold mb-6">Mes Réservations</h1>
      <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl p-8 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <span className="text-5xl block mb-4">🗓️</span>
          <p>L'interface du calendrier sera intégrée ici.</p>
          <p className="text-sm mt-2">Nous allons la connecter à PostgreSQL pour afficher les créneaux disponibles.</p>
        </div>
      </div>
    </div>
  );
}