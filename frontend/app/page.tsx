"use client";

import { useState, useEffect } from "react";
import AuthForm from "../components/AuthForm";
import Sidebar from "../components/Sidebar";
import CalendarView from "../components/CalendarView";
import ChatInterface from "../components/ChatInterface";
import CourseList from "../components/CourseList"; // 1. L'import ici

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  // On peut laisser calendar par défaut
  const [activeTab, setActiveTab] = useState("calendar");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const email = localStorage.getItem("userEmail");
    if (token && email) {
      setIsAuthenticated(true);
      setUserEmail(email);
    }
  }, []);

  const handleLogout = () => {
    localStorage.clear();
    setIsAuthenticated(false);
    setUserEmail("");
  };

  if (!isAuthenticated) {
    return (
      <AuthForm 
        onLoginSuccess={(email) => {
          setUserEmail(email);
          setIsAuthenticated(true);
        }} 
      />
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans">
      <Sidebar 
        userEmail={userEmail}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
      />

      <main className="flex-1 p-8 flex flex-col overflow-hidden">
        {/* 2. Ajout de la condition pour afficher la liste des cours */}
        {activeTab === "calendar" && (
          <CalendarView isAdmin={userEmail.trim().toLowerCase() === "prof@skeuly.com"} />
        )}
        {activeTab === "courses" && (
          <CourseList isAdmin={userEmail.trim().toLowerCase() === "prof@skeuly.com"} />
        )}
        {activeTab === "chat" && <ChatInterface userEmail={userEmail} />}
      </main>
    </div>
  );
}