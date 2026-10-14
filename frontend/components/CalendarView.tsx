"use client";
import { useState, useEffect } from "react";

type Course = {
  id: number;
  title: string;
  date: string;
  duration: string;
  status: string;
};

export default function CalendarView() {
  // --- ÉTATS DU CALENDRIER ET DONNÉES ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [courses, setCourses] = useState<Course[]>([]);
  
  // --- ÉTATS DE LA MODALE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [formData, setFormData] = useState({ title: "", time: "14:00", duration: "1h" });
  const [successMsg, setSuccessMsg] = useState("");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const emptyDaysOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  // --- RÉCUPÉRATION DES COURS DEPUIS L'API ---
  const fetchCourses = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch("http://localhost:8080/api/courses", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCourses(data);
      }
    } catch (err) {
      console.error("Erreur lors de la récupération des cours", err);
    }
  };

  // Charger les cours au montage du composant
  useEffect(() => {
    fetchCourses();
  }, []);

  // --- HELPERS ---
  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
    setSuccessMsg("");
    setIsModalOpen(true);
  };

  // Fonction pour déterminer la couleur selon le statut
  const getStatusStyle = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("confirmé") || s.includes("confirme")) {
      return "bg-green-700 text-white border-green-800"; // Vert foncé
    }
    if (s.includes("réalisé") || s.includes("realise")) {
      return "bg-gray-500 text-gray-100 border-gray-600"; // Gris
    }
    return "bg-green-300 text-green-900 border-green-400"; // Demandé / En attente (défaut)
  };

  // --- SOUMISSION DE LA RÉSERVATION ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("token");
    if (!selectedDay || !token) return;

    const [hours, minutes] = formData.time.split(':').map(Number);
    const scheduledDate = new Date(year, month, selectedDay, hours, minutes);

    try {
      const res = await fetch("http://localhost:8080/api/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          title: formData.title,
          date: scheduledDate.toISOString(),
          duration: formData.duration
        })
      });

      if (res.ok) {
        setSuccessMsg("Demande envoyée au professeur ! ✅");
        fetchCourses(); // Rafraîchir le calendrier pour afficher le nouveau cours
        setTimeout(() => {
          setIsModalOpen(false);
          setSuccessMsg("");
          setFormData({ title: "", time: "14:00", duration: "1h" });
        }, 1500);
      } else {
        const message = await res.text();
        setSuccessMsg(`❌ ${message || "Erreur lors de la réservation."}`);
      }
    } catch (err) {
      setSuccessMsg("❌ Serveur injoignable.");
    }
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full relative">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Réserver un créneau</h1>
        <div className="flex items-center gap-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
          <button onClick={prevMonth} className="px-3 py-1 hover:bg-gray-700 rounded transition-colors">&larr;</button>
          <span className="font-bold min-w-[120px] text-center">
            {monthNames[month]} {year}
          </span>
          <button onClick={nextMonth} className="px-3 py-1 hover:bg-gray-700 rounded transition-colors">&rarr;</button>
        </div>
      </div>

      <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-lg flex flex-col">
        <div className="grid grid-cols-7 gap-2 mb-4 text-center font-bold text-gray-400">
          <div>Lun</div><div>Mar</div><div>Mer</div><div>Jeu</div><div>Ven</div><div>Sam</div><div>Dim</div>
        </div>

        <div className="grid grid-cols-7 gap-2 flex-1 auto-rows-fr">
          {Array.from({ length: emptyDaysOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-gray-800/50 rounded-lg border border-gray-700/50 opacity-50"></div>
          ))}
          
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
            
            // Filtrer les cours qui tombent ce jour-là
            const dayCourses = courses.filter(c => {
              const cDate = new Date(c.date);
              return cDate.getDate() === day && cDate.getMonth() === month && cDate.getFullYear() === year;
            });

            return (
              <button
                key={day}
                onClick={() => handleDayClick(day)}
                className={`relative p-2 rounded-lg border flex flex-col items-start justify-start transition-all hover:border-blue-500 hover:bg-gray-700 group min-h-[100px] overflow-hidden
                  ${isToday ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 bg-gray-750'}`}
              >
                <span className={`font-bold mb-1 ${isToday ? 'text-blue-400' : 'text-gray-300 group-hover:text-white'}`}>{day}</span>
                
                {/* AFFICHAGE DES COURS DU JOUR */}
                <div className="flex flex-col w-full gap-1 overflow-y-auto no-scrollbar">
                  {dayCourses.map(course => {
                    const courseTime = new Date(course.date).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
                    return (
                      <div 
                        key={course.id} 
                        className={`text-[10px] w-full text-left px-1.5 py-1 rounded border truncate shadow-sm ${getStatusStyle(course.status)}`}
                        title={`${courseTime} - ${course.title} (${course.status})`} // Tooltip au survol
                      >
                        <span className="font-bold">{courseTime}</span> - {course.title}
                      </div>
                    );
                  })}
                </div>

                <span className="text-[10px] text-gray-500 mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity w-full text-center">
                  + Réserver
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* MODALE DE RÉSERVATION */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-700 p-8 rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Nouvelle demande</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white">&times;</button>
            </div>

            <p className="text-gray-400 mb-6">
              Pour le <strong className="text-white">{selectedDay} {monthNames[month]} {year}</strong>
            </p>

            {successMsg ? (
              <div className="bg-green-500/20 text-green-400 p-4 rounded-lg text-center font-bold border border-green-500/30">
                {successMsg}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Quel cours souhaitez-vous ?</label>
                  <input 
                    type="text" required 
                    value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})}
                    className="w-full bg-gray-900 border border-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500" 
                    placeholder="Ex: Révision React.js" 
                  />
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Heure souhaitée</label>
                    <input 
                      type="time" required 
                      value={formData.time} onChange={(e) => setFormData({...formData, time: e.target.value})}
                      className="w-full bg-gray-900 border border-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-400 mb-1">Durée</label>
                    <select 
                      value={formData.duration} onChange={(e) => setFormData({...formData, duration: e.target.value})}
                      className="w-full bg-gray-900 border border-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value="1h">1 Heure</option>
                      <option value="1h30">1h30</option>
                      <option value="2h">2 Heures</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 rounded-lg font-bold bg-gray-700 hover:bg-gray-600 transition-colors">
                    Annuler
                  </button>
                  <button type="submit" className="flex-1 py-2 rounded-lg font-bold bg-blue-600 hover:bg-blue-500 transition-colors">
                    Envoyer
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}