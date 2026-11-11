"use client";

import { Building2, Users, FileText, LogOut } from "lucide-react";

interface NavbarProps {
  currentTab: "overview" | "buildings" | "workers" | "reports";
  setCurrentTab: (
    tab: "overview" | "buildings" | "workers" | "reports",
  ) => void;
  onLogout: () => void;
}

export default function Navbar({
  currentTab,
  setCurrentTab,
  onLogout,
}: NavbarProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-sm">
      <div className="flex items-center gap-3">
        <div className="bg-indigo-600 text-white p-2.5 rounded-xl shadow-sm">
          <Building2 size={24} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-gray-900">
            Site Attendance Admin
          </h1>
          <p className="text-xs text-gray-500">
            Construction Operations & Geofence Control
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
          <button
            onClick={() => setCurrentTab("overview")}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              currentTab === "overview"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setCurrentTab("buildings")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              currentTab === "buildings"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Building2 size={15} /> Buildings
          </button>
          <button
            onClick={() => setCurrentTab("workers")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              currentTab === "workers"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Users size={15} /> Workers
          </button>
          <button
            onClick={() => setCurrentTab("reports")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              currentTab === "reports"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <FileText size={15} /> Reports
          </button>
        </div>

        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-gray-500 hover:text-rose-600 font-medium text-sm px-3 py-2 rounded-xl hover:bg-rose-50 transition-colors"
        >
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </header>
  );
}
