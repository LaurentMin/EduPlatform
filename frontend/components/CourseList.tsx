"use client";

// Données fictives en attendant la connexion à la base de données
const MOCK_COURSES = [
  { id: 1, title: "Cours de perfectionnement", date: "2026-10-18T14:00:00Z", status: "prévu", price: 40 },
  { id: 2, title: "Cours d'introduction", date: "2026-10-10T10:00:00Z", status: "réalisé", price: 30 },
  { id: 3, title: "Révision des bases", date: "2026-10-05T16:00:00Z", status: "réalisé", price: 30 },
];

export default function CourseList() {
  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full">
      <h1 className="text-3xl font-bold mb-6">Historique des Cours</h1>
      
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-lg">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-750 text-gray-400 text-sm uppercase tracking-wider border-b border-gray-700 bg-gray-900/50">
              <th className="p-4 font-medium">Intitulé du cours</th>
              <th className="p-4 font-medium">Date & Heure</th>
              <th className="p-4 font-medium">Prix</th>
              <th className="p-4 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {MOCK_COURSES.map((course) => (
              <tr key={course.id} className="hover:bg-gray-700/50 transition-colors">
                <td className="p-4 font-medium text-white">{course.title}</td>
                <td className="p-4 text-gray-300">
                  {new Date(course.date).toLocaleDateString("fr-FR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  }).replace(":", "h")}
                </td>
                <td className="p-4 text-white font-mono">{course.price} €</td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    course.status === "prévu" 
                      ? "bg-blue-500/10 text-blue-400 border-blue-500/20" 
                      : "bg-green-500/10 text-green-400 border-green-500/20"
                  }`}>
                    {course.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}