"use client";
import { useState, useEffect } from "react";

type Course = {
  id: number;
  title: string;
  date: string;
  duration: string;
  status: string;
};

type Availability = {
  id: number;
  start: string;
  end: string;
  recurring: true;
  exceptional?: boolean;
  rule_id: number;
  rule_weekday: number;
  rule_start: string;
  rule_end: string;
  exception_id?: number;
  exception_date?: string;
};

export default function CalendarView({ isAdmin }: { isAdmin: boolean }) {
  // --- ÉTATS DU CALENDRIER ET DONNÉES ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [courses, setCourses] = useState<Course[]>([]);
  const [occupiedCourses, setOccupiedCourses] = useState<Course[]>([]);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [availabilityError, setAvailabilityError] = useState("");
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);
  const [selectedAvailability, setSelectedAvailability] = useState<Availability | null>(null);
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState("");
  const [availabilityEditForm, setAvailabilityEditForm] = useState({ start: "", end: "" });
  const [availabilityForm, setAvailabilityForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    start: "08:00",
    end: "23:00",
    exceptional: false
  });
  
  // --- ÉTATS DE LA MODALE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [formData, setFormData] = useState({ title: "", time: "14:00", duration: "1h" });
  const [successMsg, setSuccessMsg] = useState("");

  const dayNames = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const monthNames = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const timeSlots = Array.from({ length: 60 }, (_, index) => {
    const totalMinutes = 8 * 60 + index * 15;
    return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
  });
  const startOfWeek = (date: Date) => {
    const result = new Date(date);
    const day = result.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    result.setDate(result.getDate() + mondayOffset);
    result.setHours(0, 0, 0, 0);
    return result;
  };
  const weekStart = startOfWeek(currentDate);
  const weekStartKey = weekStart.toISOString();
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
        headers: { "Authorization": "Bearer " + token }
      });
      if (res.ok) {
        const data = await res.json();
        setCourses(data);
      }
      const occupiedRes = await fetch("http://localhost:8080/api/courses/occupied", {
        headers: { "Authorization": "Bearer " + token }
      });
      if (occupiedRes.ok) {
        setOccupiedCourses(await occupiedRes.json());
      }
    } catch (err) {
      console.error("Erreur lors de la récupération des cours", err);
    }
  };

  // Charger les cours au montage du composant
  useEffect(() => {
    fetchCourses();
    const refreshTimer = window.setInterval(fetchCourses, 10000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  useEffect(() => {
    const fetchAvailability = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;
      const start = new Date(weekStartKey);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      try {
        const res = await fetch(
          `http://localhost:8080/api/availability?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
          { headers: { "Authorization": "Bearer " + token } }
        );
        if (res.ok) {
          setAvailabilities(await res.json());
        } else {
          setAvailabilityError(await res.text() || "Impossible de charger les disponibilités.");
        }
      } catch {
        setAvailabilityError("Impossible de charger les disponibilités.");
      }
    };
    fetchAvailability();
  }, [weekStartKey]);

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

  const handleSlotClick = (day: Date, hour: number, minute: number) => {
    const selected = new Date(day);
    selected.setHours(hour, minute, 0, 0);
    setSelectedDate(selected);
    setFormData((previous) => ({
      ...previous,
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    }));
    setSuccessMsg("");
    setIsModalOpen(true);
  };

  const isAvailable = (day: Date, hour: number, minute: number) => {
    const slotMinutes = hour * 60 + minute;
    return availabilities.some((availability) => {
      if (availability.rule_weekday !== day.getDay()) return false;
      const [startHour, startMinute] = availability.rule_start.split(":").map(Number);
      const [endHour, endMinute] = availability.rule_end.split(":").map(Number);
      return slotMinutes >= startHour * 60 + startMinute &&
        slotMinutes + 15 <= endHour * 60 + endMinute;
    });
  };

  const isOccupied = (day: Date, hour: number, minute: number) => {
    const slotStart = new Date(day);
    slotStart.setHours(hour, minute, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);
    return occupiedCourses.some((course) => {
      const courseStart = new Date(course.date);
      const courseEnd = new Date(courseStart.getTime() + parseDuration(course.duration) * 60 * 1000);
      return courseStart < slotEnd && slotStart < courseEnd;
    });
  };

  const openAvailabilityEditor = (day: Date, hour: number, minute: number) => {
    const availability = availabilities.find((item) =>
      item.rule_weekday === day.getDay() &&
      hour * 60 + minute >= Number(item.rule_start.slice(0, 2)) * 60 + Number(item.rule_start.slice(3, 5)) &&
      hour * 60 + minute + 15 <= Number(item.rule_end.slice(0, 2)) * 60 + Number(item.rule_end.slice(3, 5))
    );
    if (!availability) return;
    setSelectedAvailability(availability);
    setSelectedAvailabilityDate(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`);
    setAvailabilityEditForm({
      start: availability.rule_start.slice(0, 5),
      end: availability.rule_end.slice(0, 5)
    });
  };

  const refreshAvailabilities = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    const response = await fetch(
      `http://localhost:8080/api/availability?start=${encodeURIComponent(weekStart.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
      { headers: { "Authorization": "Bearer " + token } }
    );
    if (response.ok) setAvailabilities(await response.json());
  };

  const updateAvailability = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAvailability) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const endpoint = selectedAvailability.exceptional
      ? `http://localhost:8080/api/availability-exceptions/${selectedAvailability.exception_id}`
      : `http://localhost:8080/api/availability-rules/${selectedAvailability.rule_id}`;
    const body = selectedAvailability.exceptional
      ? { date: selectedAvailabilityDate, start: availabilityEditForm.start, end: availabilityEditForm.end }
      : { start: availabilityEditForm.start, end: availabilityEditForm.end };
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      setAvailabilityError(await response.text() || "Impossible de modifier cette disponibilité.");
      return;
    }
    setSelectedAvailability(null);
    await refreshAvailabilities();
  };

  const deleteAvailability = async () => {
    if (!selectedAvailability) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const endpoint = selectedAvailability.exceptional
      ? `http://localhost:8080/api/availability-exceptions/${selectedAvailability.exception_id}`
      : `http://localhost:8080/api/availability-rules/${selectedAvailability.rule_id}`;
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!response.ok) {
      setAvailabilityError(await response.text() || "Impossible de supprimer cette disponibilité.");
      return;
    }
    setSelectedAvailability(null);
    await refreshAvailabilities();
  };

  const addAvailability = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem("token");
    if (!token) return;
    setAvailabilityError("");
    try {
      const res = await fetch(`http://localhost:8080/api/${availabilityForm.exceptional ? "availability-exceptions" : "availability"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          date: availabilityForm.date,
          start: availabilityForm.start,
          end: availabilityForm.end
        })
      });
      if (!res.ok) {
        setAvailabilityError(await res.text() || "Impossible d'ajouter cette disponibilité.");
        return;
      }
      setIsAvailabilityModalOpen(false);
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 7);
      const refreshed = await fetch(
        `http://localhost:8080/api/availability?start=${encodeURIComponent(weekStart.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
        { headers: { "Authorization": "Bearer " + token } }
      );
      if (refreshed.ok) setAvailabilities(await refreshed.json());
    } catch {
      setAvailabilityError("Serveur injoignable.");
    }
  };

  const createExceptionForSelectedDay = async () => {
    if (!selectedAvailability) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const response = await fetch("http://localhost:8080/api/availability-exceptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({
        date: selectedAvailabilityDate,
        start: availabilityEditForm.start,
        end: availabilityEditForm.end
      })
    });
    if (!response.ok) {
      setAvailabilityError(await response.text() || "Impossible de créer l'exception.");
      return;
    }
    setSelectedAvailability(null);
    await refreshAvailabilities();
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
          "Authorization": "Bearer " + token,
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
    } catch {
      setSuccessMsg("❌ Serveur injoignable.");
    }
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full relative">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{isAdmin ? "Mes disponibilités" : "Réserver un créneau"}</h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setIsAvailabilityModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg font-bold"
          >
            + Ajouter
          </button>
        )}
        <div className="flex items-center gap-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
          <button onClick={previousWeek} className="px-3 py-1 hover:bg-gray-700 rounded transition-colors">&larr;</button>
          <span className="font-bold min-w-[230px] text-center">
            Semaine du {formatDate(weekStart)}
          </span>
          <button onClick={nextWeek} className="px-3 py-1 hover:bg-gray-700 rounded transition-colors">&rarr;</button>
        </div>
        {isAdmin && (
          <p className="text-sm text-gray-400 mb-3">
            Utilisez le bouton « Ajouter » pour définir une règle de disponibilité hebdomadaire.
          </p>
        )}
        {availabilityError && (
          <p className="text-red-400 bg-red-900/20 p-3 rounded-lg mb-3">{availabilityError}</p>
        )}
        {isAvailabilityModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm">
            <form onSubmit={addAvailability} className="bg-gray-800 border border-gray-700 p-6 rounded-xl shadow-2xl w-full max-w-md">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-bold">Ajouter une disponibilité</h2>
                <button type="button" onClick={() => setIsAvailabilityModalOpen(false)} className="text-gray-400 hover:text-white">&times;</button>
              </div>
              <div className="flex flex-col gap-4">
                <label className="text-sm text-gray-300">
                  Date
                  <input
                    type="date"
                    required
                    value={availabilityForm.date}
                    onChange={(event) => setAvailabilityForm({ ...availabilityForm, date: event.target.value })}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  />
                </label>
                <div className="flex gap-3">
                  <label className="flex-1 text-sm text-gray-300">
                    Début
                    <input
                      type="time"
                      step="900"
                      required
                      value={availabilityForm.start}
                      onChange={(event) => setAvailabilityForm({ ...availabilityForm, start: event.target.value })}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    />
                  </label>
                  <label className="flex-1 text-sm text-gray-300">
                    Fin
                    <input
                      type="time"
                      step="900"
                      required
                      value={availabilityForm.end}
                      onChange={(event) => setAvailabilityForm({ ...availabilityForm, end: event.target.value })}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    />
                  </label>
                </div>
                <p className="text-sm text-gray-400">
                  {availabilityForm.exceptional
                    ? "Cette disponibilité concerne uniquement la date choisie."
                    : "Cette disponibilité sera répétée chaque semaine."}
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={availabilityForm.exceptional}
                    onChange={(event) => setAvailabilityForm({ ...availabilityForm, exceptional: event.target.checked })}
                  />
                  Disponibilité exceptionnelle
                </label>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setIsAvailabilityModalOpen(false)} className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 font-bold">
                    Annuler
                  </button>
                  <button type="submit" className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 font-bold">
                    Ajouter
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
        {selectedAvailability && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm">
            <form onSubmit={updateAvailability} className="bg-gray-800 border border-gray-700 p-6 rounded-xl shadow-2xl w-full max-w-md">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-bold">
                  {selectedAvailability.exceptional ? "Modifier l'exception" : "Modifier la règle hebdomadaire"}
                </h2>
                <button type="button" onClick={() => setSelectedAvailability(null)} className="text-gray-400 hover:text-white">&times;</button>
              </div>
              <div className="flex gap-3">
                <label className="flex-1 text-sm text-gray-300">
                  Début
                  <input type="time" step="900" required value={availabilityEditForm.start}
                    onChange={(event) => setAvailabilityEditForm({ ...availabilityEditForm, start: event.target.value })}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </label>
                <label className="flex-1 text-sm text-gray-300">
                  Fin
                  <input type="time" step="900" required value={availabilityEditForm.end}
                    onChange={(event) => setAvailabilityEditForm({ ...availabilityEditForm, end: event.target.value })}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </label>
              </div>
              <div className="flex gap-3 pt-5">
                {!selectedAvailability.exceptional && (
                  <button type="button" onClick={createExceptionForSelectedDay} className="flex-1 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 font-bold">
                    Modifier ce jour
                  </button>
                )}
                <button type="button" onClick={deleteAvailability} className="flex-1 py-2 rounded-lg bg-red-700 hover:bg-red-600 font-bold">
                  Supprimer
                </button>
                <button type="submit" className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 font-bold">
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        )}
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

          {timeSlots.map(({ hour, minute }) => (
            <div key={`${hour}-${minute}`} className="grid grid-cols-[64px_repeat(7,minmax(115px,1fr))] min-h-[16px]">
              <div className="border-r border-b border-gray-700 px-2 pt-1 text-xs text-gray-400 text-right">
                {minute === 0 ? `${String(hour).padStart(2, "0")}h` : ""}
              </div>
              {weekDays.map((day) => {
                const dayCourses = courses.filter((course) => {
                  const courseDate = new Date(course.date);
                  return courseDate.toDateString() === day.toDateString() &&
                    courseDate.getHours() === hour &&
                    courseDate.getMinutes() === minute;
                });
                const available = isAvailable(day, hour, minute);
                const occupied = isOccupied(day, hour, minute);
                const bookable = available && !occupied;
                return (
                  <button
                    key={`${day.toISOString()}-${hour}-${minute}`}
                    type="button"
                    onClick={() => isAdmin
                      ? available && openAvailabilityEditor(day, hour, minute)
                      : bookable && handleSlotClick(day, hour, minute)}
                    className={`relative border-r border-b border-gray-700 transition-colors text-left ${
                      bookable ? "bg-blue-500/10 hover:bg-blue-500/20" : "bg-gray-800/60"
                    }`}
                    aria-label={`Réserver le ${formatDate(day)} à ${String(hour).padStart(2, "0")}h${String(minute).padStart(2, "0")}`}
                  >
                    {dayCourses.map((course) => (
                      <div
                        key={course.id}
                        className={`absolute inset-x-1 top-1 z-[1] rounded border p-1.5 text-xs overflow-hidden shadow ${getStatusStyle(course.status)}`}
                        style={{ height: `${Math.max(32, parseDuration(course.duration) * 16 / 15 - 4)}px` }}
                        title={`${formatTime(new Date(course.date))} - ${course.title} (${course.status})`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="font-bold truncate">{formatTime(new Date(course.date))}</div>
                        <div className="truncate">{course.title}</div>
                        <div className="truncate opacity-75">{course.duration}</div>
                      </div>
                    ))}
                    {isAdmin && available && dayCourses.length === 0 && (
                      <span className="absolute bottom-1 right-1 text-[10px] text-blue-300">Disponible</span>
                    )}
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