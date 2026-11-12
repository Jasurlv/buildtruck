"use client";

import { useState, useEffect } from "react";
import { Users, Plus, Trash2, Edit, MapPin } from "lucide-react";
import { adminFetch } from "@/utils/api";
import { useTranslation } from "@/i18n";
import { errorTextOf, throwApiError } from "@/i18n/apiErrors";

interface WorkersTableProps {
  token: string;
  showNotification: (msg: string, type: "success" | "error") => void;
  onOpenAddModal: () => void;
  onOpenEditModal: (worker: any) => void;
  refreshTrigger: number;
}

export default function WorkersTable({
  token,
  showNotification,
  onOpenAddModal,
  onOpenEditModal,
  refreshTrigger,
}: WorkersTableProps) {
  const [workers, setWorkers] = useState<any[]>([]);
  const { t } = useTranslation();

  const fetchWorkers = async () => {
    try {
      const res = await adminFetch("/workers", token);
      if (!res.ok) await throwApiError(res);
      const data = await res.json();
      setWorkers(data);
    } catch {
      showNotification(t("workers.loadFailed"), "error");
    }
  };

  useEffect(() => {
    fetchWorkers();
  }, [refreshTrigger, token]);

  const handleDelete = async (id: number) => {
    if (!confirm(t("workers.confirmDelete"))) return;
    try {
      const response = await adminFetch(`/workers/${id}`, token, { method: "DELETE" });
      if (!response.ok) await throwApiError(response);
      showNotification(t("workers.deleted"), "success");
      fetchWorkers();
    } catch (err) {
      const text = errorTextOf(err, "workers.deleteFailed");
      showNotification(
        text.key === "errors.generic" ? t("workers.deleteFailed") : t(text.key, text.values),
        "error",
      );
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
            <Users size={20} className="text-indigo-600" />{" "}
            {t("workers.title", { count: workers.length })}
          </h3>
          <p className="text-xs text-gray-500">{t("workers.subtitle")}</p>
        </div>
        <button
          onClick={onOpenAddModal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition-all"
        >
          <Plus size={16} /> {t("workers.add")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/70 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="py-3.5 px-6">{t("workers.colName")}</th>
              <th className="py-3.5 px-6">{t("workers.colUsername")}</th>
              <th className="py-3.5 px-6">{t("workers.colRate")}</th>
              <th className="py-3.5 px-6">{t("workers.colStart")}</th>
              <th className="py-3.5 px-6">{t("workers.colSite")}</th>
              <th className="py-3.5 px-6 text-right">{t("workers.colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {workers.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  {t("workers.empty")}
                </td>
              </tr>
            ) : (
              workers.map((w) => (
                <tr
                  key={w.id}
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <td className="py-4 px-6 font-semibold text-gray-900">
                    {w.full_name}
                  </td>
                  <td className="py-4 px-6 font-mono text-xs text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded w-fit">
                    {w.username}
                  </td>
                  <td className="py-4 px-6 font-medium text-emerald-700">
                    {t("workers.rate", { rate: w.hourly_rate })}
                  </td>
                  <td className="py-4 px-6 tabular-nums text-gray-700">
                    {w.work_start_time}
                  </td>
                  <td className="py-4 px-6">
                    {w.building_name ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <MapPin size={12} /> {w.building_name}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic text-xs">
                        {t("workers.unassigned")}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right space-x-1">
                    <button
                      onClick={() => onOpenEditModal(w)}
                      aria-label={t("common.edit")}
                      title={t("common.edit")}
                      className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(w.id)}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                      className="text-gray-400 hover:text-rose-600 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
