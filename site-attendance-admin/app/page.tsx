"use client";

import { Suspense, useState, useEffect } from "react";
import {
  Building2,
  Users,
  Lock,
  User,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import BuildingsTable from "@/components/BuildingsTable";
import WorkersTable from "@/components/WorkersTable";
import BuildingModal from "@/components/BuildingModal";
import WorkerModal from "@/components/WorkerModal";
import AttendanceReport from "@/components/AttendanceReport";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { adminFetch } from "@/utils/api";
import { useTranslation } from "@/i18n";
import { errorTextOf, readJson, throwApiError, type ErrorText } from "@/i18n/apiErrors";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "";

export default function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Kept as a key, so the message follows a language change.
  const [error, setError] = useState<ErrorText | null>(null);
  const { t } = useTranslation();

  const [currentTab, setCurrentTab] = useState<
    "overview" | "buildings" | "workers" | "reports"
  >("overview");

  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);

  const [selectedBuilding, setSelectedBuilding] = useState<any | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<any | null>(null);

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [stats, setStats] = useState({ buildingsCount: 0, workersCount: 0 });

  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showNotification = (message: string, type: "success" | "error") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  useEffect(() => {
    const savedToken = localStorage.getItem("admin_token");
    const tokenTime = localStorage.getItem("admin_token_time");

    if (savedToken && tokenTime) {
      const elapsedMinutes = (Date.now() - Number(tokenTime)) / (1000 * 60);
      if (elapsedMinutes < 30) {
        setToken(savedToken);
      } else {
        handleLogout();
        showNotification(t("session.expiredOnOpen"), "error");
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    const interval = setInterval(() => {
      const tokenTime = localStorage.getItem("admin_token_time");
      if (tokenTime) {
        const elapsedMinutes = (Date.now() - Number(tokenTime)) / (1000 * 60);
        if (elapsedMinutes >= 30) {
          handleLogout();
          showNotification(t("session.expired"), "error");
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [token, t]);

  useEffect(() => {
    if (token) {
      Promise.all([
        adminFetch("/buildings", token).then((res) => {
          if (!res.ok) throw new Error("Failed to load buildings");
          return res.json();
        }),
        adminFetch("/workers", token).then((res) => {
          if (!res.ok) throw new Error("Failed to load workers");
          return res.json();
        }),
      ])
        .then(([bData, wData]) => {
          setStats({
            buildingsCount: bData.length || 0,
            workersCount: wData.length || 0,
          });
        })
        .catch(() => console.error("Failed to load summary stats"));
    }
  }, [token, refreshTrigger]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const res = await adminFetch("/admin/login", null, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await readJson(res);

      if (!res.ok) await throwApiError(res, data);

      localStorage.setItem("admin_token", data.token);
      localStorage.setItem("admin_token_time", Date.now().toString());
      setToken(data.token);
      showNotification(t("login.success"), "success");
    } catch (err) {
      setError(errorTextOf(err));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_token_time");
    setToken(null);
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-8 border border-gray-100">
          <div className="flex justify-end mb-2">
            <LanguageSwitcher />
          </div>
          <div className="flex flex-col items-center mb-6">
            <div className="bg-indigo-600 text-white p-3 rounded-2xl mb-3 shadow-md">
              <Building2 size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t("login.title")}</h1>
            <p className="text-xs text-gray-500">{t("login.subtitle")}</p>
            {!API_URL && process.env.NODE_ENV === "production" && (
              <p className="mt-3 text-center text-xs text-rose-700">
                {t("login.apiNotConfigured")}
              </p>
            )}
          </div>

          {error && (
            <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={16} /> {t(error.key, error.values)}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
                {t("login.username")}
              </label>
              <div className="relative">
                <User
                  size={16}
                  className="absolute left-3.5 top-3 text-gray-400"
                />
                <input
                  type="text"
                  required
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
                {t("login.password")}
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3.5 top-3 text-gray-400"
                />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl shadow-sm transition-all mt-2 text-sm"
            >
              {t("login.signIn")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {notification && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-white transition-all transform animate-bounce ${
            notification.type === "success" ? "bg-emerald-600" : "bg-rose-600"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircle2 size={22} />
          ) : (
            <AlertCircle size={22} />
          )}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {currentTab === "overview" && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                {t("overview.title")}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{t("overview.subtitle")}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div
                onClick={() => setCurrentTab("buildings")}
                className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:border-indigo-300 transition-all cursor-pointer group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-indigo-50 text-indigo-600 p-3 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Building2 size={24} />
                  </div>
                  <span className="text-xs font-medium text-indigo-600 flex items-center gap-1">
                    {t("overview.manage")} <ArrowRight size={14} />
                  </span>
                </div>
                <h3 className="text-3xl font-bold text-gray-900 mb-1">
                  {stats.buildingsCount}
                </h3>
                <p className="text-sm font-medium text-gray-600">
                  {t("overview.buildings")}
                </p>
              </div>

              <div
                onClick={() => setCurrentTab("workers")}
                className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:border-indigo-300 transition-all cursor-pointer group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <Users size={24} />
                  </div>
                  <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                    {t("overview.manage")} <ArrowRight size={14} />
                  </span>
                </div>
                <h3 className="text-3xl font-bold text-gray-900 mb-1">
                  {stats.workersCount}
                </h3>
                <p className="text-sm font-medium text-gray-600">
                  {t("overview.workers")}
                </p>
              </div>
            </div>
          </div>
        )}

        {currentTab === "buildings" && (
          <BuildingsTable
            token={token}
            showNotification={showNotification}
            onOpenAddModal={() => {
              setSelectedBuilding(null);
              setIsBuildingModalOpen(true);
            }}
            onOpenEditModal={(building) => {
              setSelectedBuilding(building);
              setIsBuildingModalOpen(true);
            }}
            refreshTrigger={refreshTrigger}
          />
        )}

        {currentTab === "workers" && (
          <WorkersTable
            token={token}
            showNotification={showNotification}
            onOpenAddModal={() => {
              setSelectedWorker(null);
              setIsWorkerModalOpen(true);
            }}
            onOpenEditModal={(worker) => {
              setSelectedWorker(worker);
              setIsWorkerModalOpen(true);
            }}
            refreshTrigger={refreshTrigger}
          />
        )}

        {currentTab === "reports" && (
          // AttendanceReport reads the URL query (useSearchParams).
          <Suspense fallback={<p className="text-sm text-gray-500">{t("report.loadingReport")}</p>}>
            <AttendanceReport token={token} />
          </Suspense>
        )}
      </main>

      <BuildingModal
        isOpen={isBuildingModalOpen}
        onClose={() => {
          setIsBuildingModalOpen(false);
          setSelectedBuilding(null);
        }}
        onSuccess={() => setRefreshTrigger((prev) => prev + 1)}
        showNotification={showNotification}
        token={token}
        buildingToEdit={selectedBuilding}
      />

      <WorkerModal
        isOpen={isWorkerModalOpen}
        onClose={() => {
          setIsWorkerModalOpen(false);
          setSelectedWorker(null);
        }}
        onSuccess={() => setRefreshTrigger((prev) => prev + 1)}
        showNotification={showNotification}
        token={token}
        workerToEdit={selectedWorker}
      />
      {notification && (
        <div
          className={`fixed top-5 right-5 z-[9999] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl text-white transition-all transform animate-bounce ${
            notification.type === "success" ? "bg-emerald-600" : "bg-rose-600"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircle2 size={22} />
          ) : (
            <AlertCircle size={22} />
          )}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
    </div>
  );
}
