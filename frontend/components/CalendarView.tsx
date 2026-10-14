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
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [formData, setFormData] = useState({ title: "", time: "14:00", duration: "1h" });
  const [successMsg, setSuccessMsg] = useState("");

  const dayNames = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const monthNames = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const hours = Array.from({ length: 15 }, (_, index) => index + 8);
  const startOfWeek = (date: Date) => {
    const result = new Date(date);
    const day = result.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    result.setDate(result.getDate() + mondayOffset);
    result.setHours(0, 0, 0, 0);
    return result;
  };
  const weekStart = startOfWeek(currentDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });
  const formatDate = (date: Date) =>
    `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  const formatTime = (date: Date) =>
    date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
  const parseDuration = (duration: string) => {
    const match = duration.match(/(\d+)h(?:(\d+))?/i);
    return match ? Number(match[1]) * 60 + Number(match[2] || 0) : 60;
  };

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
  const previousWeek = () => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - 7);
    setCurrentDate(date);
  };
  const nextWeek = () => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + 7);
    setCurrentDate(date);
  };

  const handleSlotClick = (day: Date, hour: number) => {
    const selected = new Date(day);
    selected.setHours(hour, 0, 0, 0);
    setSelectedDate(selected);
    setFormData((previous) => ({
      ...previous,
      time: `${String(hour).padStart(2, "0")}:00`
    }));
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
    if (!selectedDate || !token) return;

    const [hours, minutes] = formData.time.split(':').map(Number);
    const scheduledDate = new Date(selectedDate);
    scheduledDate.setHours(hours, minutes, 0, 0);

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
          <button onClick={previousWeek} className="px-3 py-1 hover:bg-gray-700 rounded transition-colors">&larr;</button>
          <span className="font-bold min-w-[230px] text-center">
            Semaine du {formatDate(weekStart)}
          </span>
          <button onClick={nextWeek} className="px-3 py-1 hover:bg-gray-700 rounded transition-colors">&rarr;</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-gray-800 border border-gray-700 rounded-xl shadow-lg overflow-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[64px_repeat(7,minmax(115px,1fr))] border-b border-gray-700 sticky top-0 z-10 bg-gray-800">
            <div className="border-r border-gray-700" />
            {weekDays.map((day, index) => {
              const today = new Date();
              const isToday = day.toDateString() === today.toDateString();
              return (
                <div key={day.toISOString()} className={`p-3 text-center border-r border-gray-700 ${isToday ? "bg-blue-500/10" : ""}`}>
                  <div className="text-xs text-gray-400 uppercase">{dayNames[index]}</div>
                  <div className={`text-lg font-bold ${isToday ? "text-blue-400" : "text-white"}`}>{day.getDate()}</div>
                </div>
              );
            })}
          </div>

          {hours.map((hour) => (
            <div key={hour} className="grid grid-cols-[64px_repeat(7,minmax(115px,1fr))] min-h-[64px]">
              <div className="border-r border-b border-gray-700 px-2 pt-1 text-xs text-gray-400 text-right">
                {String(hour).padStart(2, "0")}h
              </div>
              {weekDays.map((day) => {
                const dayCourses = courses.filter((course) => {
                  const courseDate = new Date(course.date);
                  return courseDate.toDateString() === day.toDateString() &&
                    courseDate.getHours() === hour;
                });
                return (
                  <button
                    key={`${day.toISOString()}-${hour}`}
                    type="button"
                    onClick={() => handleSlotClick(day, hour)}
                    className="relative border-r border-b border-gray-700 bg-gray-800/60 hover:bg-blue-500/10 transition-colors text-left"
                    aria-label={`Réserver le ${formatDate(day)} à ${String(hour).padStart(2, "0")}h`}
                  >
                    {dayCourses.map((course) => (
                      <div
                        key={course.id}
                        className={`absolute inset-x-1 top-1 z-[1] rounded border p-1.5 text-xs overflow-hidden shadow ${getStatusStyle(course.status)}`}
                        style={{ height: `${Math.max(48, parseDuration(course.duration) * 64 / 60 - 8)}px` }}
                        title={`${formatTime(new Date(course.date))} - ${course.title} (${course.status})`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="font-bold truncate">{formatTime(new Date(course.date))}</div>
                        <div className="truncate">{course.title}</div>
                        <div className="truncate opacity-75">{course.duration}</div>
                      </div>
                    ))}
                  </button>
                );
              })}
            </div>
          ))}
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
              Pour le <strong className="text-white">{selectedDate && formatDate(selectedDate)}</strong>
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