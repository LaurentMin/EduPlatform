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

export default function CourseList() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      } catch (err) {
        setError("Serveur injoignable.");
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, []);

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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-400 italic">
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
                        course.status === "prévu" 
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20" 
                          : "bg-green-500/10 text-green-400 border-green-500/20"
                      }`}>
                        {course.status.toUpperCase()}
                      </span>
                    </td>
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