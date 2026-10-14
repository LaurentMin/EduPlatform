"use client";
import { useState, useEffect } from "react";

type Course = {
  id: number;
  title: string;
  date: string;
  duration: string;
  status: string;
  price: number;
};

export default function CourseList({ isAdmin }: { isAdmin: boolean }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptingCourseId, setAcceptingCourseId] = useState<number | null>(null);
  const [reschedulingCourseId, setReschedulingCourseId] = useState<number | null>(null);
  const [newDate, setNewDate] = useState("");
  useEffect(() => {
    const fetchCourses = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const res = await fetch("http://localhost:8080/api/courses", {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setCourses(data);
        } else {
          setError("Erreur lors de la récupération des cours.");
        }
      } catch {
        setError("Serveur injoignable.");
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, []);

  const acceptCourse = async (courseId: number) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    setAcceptingCourseId(courseId);
    setError("");
    try {
      const res = await fetch(`http://localhost:8080/api/courses/${courseId}/accept`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      if (!res.ok) {
        setError("Impossible d'accepter cette demande.");
        return;
      }

      setCourses((previousCourses) =>
        previousCourses.map((course) =>
          course.id === courseId ? { ...course, status: "confirmé" } : course
        )
      );
    } catch (err) {
      setError("Serveur injoignable.");
    } finally {
      setAcceptingCourseId(null);
    }
  };

  const rescheduleCourse = async (course: Course) => {
    const token = localStorage.getItem("token");
    if (!token || !newDate) return;

    setReschedulingCourseId(course.id);
    setError("");
    try {
      const res = await fetch(`http://localhost:8080/api/courses/${course.id}/reschedule`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ date: new Date(newDate).toISOString() })
      });

      if (!res.ok) {
        const message = await res.text();
        setError(message || "Impossible de reprogrammer ce cours.");
        return;
      }

      setCourses((previousCourses) =>
        previousCourses.map((item) =>
          item.id === course.id ? { ...item, date: new Date(newDate).toISOString() } : item
        )
      );
      setNewDate("");
    } catch {
      setError("Serveur injoignable.");
    } finally {
      setReschedulingCourseId(null);
    }
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full">
      <h1 className="text-3xl font-bold mb-6">Historique des Cours</h1>
      
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : error ? (
        <p className="text-red-400 bg-red-900/20 p-4 rounded-lg">{error}</p>
      ) : (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-750 text-gray-400 text-sm uppercase tracking-wider border-b border-gray-700 bg-gray-900/50">
                <th className="p-4 font-medium">Intitulé du cours</th>
                <th className="p-4 font-medium">Date & Heure</th>
                <th className="p-4 font-medium">Durée</th>
                <th className="p-4 font-medium">Prix</th>
                <th className="p-4 font-medium">Statut</th>
                {isAdmin && <th className="p-4 font-medium">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="p-8 text-center text-gray-400 italic">
                    Vous n'avez encore réservé aucun cours.
                  </td>
                </tr>
              ) : (
                courses.map((course) => (
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
                    <td className="p-4 text-gray-300">{course.duration}</td>
                    <td className="p-4 text-white font-mono">{course.price} €</td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        course.status.toLowerCase().includes("réalisé")
                          ? "bg-gray-500/10 text-gray-400 border-gray-500/20" // Gris
                          : course.status.toLowerCase().includes("confirmé")
                          ? "bg-green-500/10 text-green-400 border-green-500/20" // Vert
                          : "bg-green-300 text-green-900 border-green-400" // Vert clair (Demandé)
                      }`}>
                        {course.status.toUpperCase()}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="p-4">
                        <div className="flex flex-col gap-2 min-w-[180px]">
                          {course.status.toLowerCase().includes("demand") && (
                            <button
                              type="button"
                              onClick={() => acceptCourse(course.id)}
                              disabled={acceptingCourseId === course.id}
                              className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                            >
                              {acceptingCourseId === course.id ? "Acceptation..." : "Accepter"}
                            </button>
                          )}
                          {!course.status.toLowerCase().includes("réalisé") &&
                            !course.status.toLowerCase().includes("realise") && (
                            <>
                              <input
                                type="datetime-local"
                                value={reschedulingCourseId === course.id ? newDate : ""}
                                onChange={(event) => {
                                  setReschedulingCourseId(course.id);
                                  setNewDate(event.target.value);
                                }}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-xs text-white"
                              />
                              <button
                                type="button"
                                onClick={() => rescheduleCourse(course)}
                                disabled={reschedulingCourseId !== course.id || !newDate}
                                className="bg-purple-600 hover:bg-purple-500 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                              >
                                {reschedulingCourseId === course.id ? "Reprogrammer" : "Nouvelle date"}
                              </button>
                            </>
                          )}
                          {course.status.toLowerCase().includes("réalisé") && (
                            <span className="text-gray-500 text-sm">Terminée</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}