"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { adminFetch } from "@/utils/api";
import { serverNow } from "@/utils/serverClock";
import {
  APP_TIMEZONE,
  defaultDateRange,
  formatAppDateTime,
  formatWorkDate,
} from "@/utils/appTimezone";
import { useTranslation, type TranslationKey } from "@/i18n";
import { errorTextOf, readJson, throwApiError, type ErrorText } from "@/i18n/apiErrors";

// "Europe/Riga" -> "Riga"
const APP_TIMEZONE_CITY = APP_TIMEZONE.split("/").pop()!.replace(/_/g, " ");

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 100; // the API's limit

type Shift = {
  id: number;
  full_name: string;
  username: string;
  building_name: string | null;
  work_date: string;
  punch_in_time: string;
  lunch_start_time: string | null;
  lunch_end_time: string | null;
  end_work_time: string | null;
  total_worked_hours: number | string | null;
  daily_earned: number | string | null;
  // Calculated by the server. Null on shifts from before these rules existed.
  arrival_at: string | null;
  paid_start_at: string | null;
  waiting_minutes: number | null;
  lateness_minutes: number | null;
  lunch_minutes: number | null;
  lunch_deducted_minutes: number | string | null;
  // Break time deducted; null while the shift is running.
  break_minutes: number | string | null;
  // The server ended the shift after the maximum shift length.
  auto_closed: boolean;
};

const COLUMN_COUNT = 14;

type ReportPage = {
  rows: Shift[];
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  // Over all rows matching the filters, not just this page.
  totals: { periods: number; hours: number; earnings: number };
};

// A response tagged with the request it answers, so a result for old filters is
// never shown as current, and "loading" is simply "no result for this key yet".
// Errors are kept as translation keys, so they follow a language change.
type ReportResult = { key: string; data?: ReportPage; error?: ErrorText };

const COLUMNS: TranslationKey[] = [
  "report.colWorker",
  "report.colSite",
  "report.colWorkDate",
  "report.colArrival",
  "report.colPaidStart",
  "report.colWaiting",
  "report.colLate",
  "report.colLunchStart",
  "report.colLunchEnd",
  "report.colLunch",
  "report.colBreak",
  "report.colFinished",
  "report.colHours",
  "report.colEarned",
];

function requestKeyOf(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function parsePageSize(value: string | null): number {
  const size = Number(value);
  return PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
}

/** The search actually sent: trimmed, and empty until it has 2+ characters. */
function effectiveSearch(input: string): string {
  const text = input.trim().slice(0, SEARCH_MAX_LENGTH);
  return text.length >= SEARCH_MIN_LENGTH ? text : "";
}

/** Minutes actually deducted for lunch; the chosen length while the shift is running. */
function lunchMinutesOf(shift: Shift): number | null {
  const minutes = shift.lunch_deducted_minutes ?? shift.lunch_minutes;
  return minutes === null ? null : Number(minutes);
}

/** Break minutes as a number (they can be fractional), or null while running. */
function breakMinutesOf(shift: Shift): number | null {
  return shift.break_minutes === null || shift.break_minutes === undefined
    ? null
    : Number(shift.break_minutes);
}

function AutoClosedBadge() {
  const { t } = useTranslation();
  return (
    <span
      title={t("report.autoClosedTitle")}
      className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
    >
      {t("report.autoClosed")}
    </span>
  );
}

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export default function AttendanceReport({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const { t, language } = useTranslation();

  // Last 30 days in the sites' timezone, matching how the backend files
  // work_date; the browser's own date can be a day behind or ahead.
  const [startDate, setStartDate] = useState(() => defaultDateRange(serverNow()).start);
  const [endDate, setEndDate] = useState(() => defaultDateRange(serverNow()).end);
  const datesEdited = useRef(false);
  // Page, search and page size start from the URL (?page=2&search=...&page_size=25).
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") ?? "");
  const [search, setSearch] = useState(() => effectiveSearch(searchParams.get("search") ?? ""));
  const [page, setPage] = useState(() => parsePage(searchParams.get("page")));
  const [pageSize, setPageSize] = useState(() => parsePageSize(searchParams.get("page_size")));
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ErrorText | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedSearch = useRef(search);

  const requestKey = requestKeyOf(startDate, endDate, search, page, pageSize, refreshCount);
  const loading = result?.key !== requestKey;
  // While the next page loads, keep the previous one on screen (dimmed).
  const data = result?.data;
  const error = !loading ? result?.error : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const key = requestKeyOf(startDate, endDate, search, page, pageSize, refreshCount);
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      page: String(page),
      page_size: String(pageSize),
    });
    if (search) params.set("search", search);

    adminFetch(`/reports?${params}`, token, { signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) await throwApiError(response, body);
        return body as ReportPage;
      })
      .then((report) => {
        if (controller.signal.aborted) return; // superseded while the body was read
        // The response may be what first reveals the server's time. If the default
        // dates were based on a wrong computer clock, correct them and reload
        // without ever showing the wrong range. Dates the admin chose are kept.
        if (!datesEdited.current) {
          const range = defaultDateRange(serverNow());
          if (range.start !== startDate || range.end !== endDate) {
            setStartDate(range.start);
            setEndDate(range.end);
            return;
          }
        }
        // E.g. a bookmarked ?page=9 after the data shrank: jump to the last page.
        if (report.total_rows > 0 && report.page > report.total_pages) {
          setPage(report.total_pages);
          return;
        }
        setResult({ key, data: report });
      })
      .catch((loadError) => {
        // A newer request replaced this one; its result is irrelevant.
        if (controller.signal.aborted) return;
        setResult({ key, error: errorTextOf(loadError) });
      });

    return () => controller.abort();
  }, [token, startDate, endDate, search, page, pageSize, refreshCount]);

  // Mirror page, search and page size in the URL without navigating.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const update = (name: string, value: string | null) =>
      value === null ? params.delete(name) : params.set(name, value);
    update("page", page > 1 ? String(page) : null);
    update("page_size", pageSize !== DEFAULT_PAGE_SIZE ? String(pageSize) : null);
    update("search", search || null);
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", url);
    }
  }, [page, pageSize, search]);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const length = value.trim().length;
      if (length > 0 && length < SEARCH_MIN_LENGTH) return; // wait for a 2nd character
      const next = effectiveSearch(value);
      if (next === appliedSearch.current) return;
      appliedSearch.current = next;
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  };

  const downloadCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      // Every matching row, not just the current page.
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      if (search) params.set("search", search);
      const response = await adminFetch(`/reports/export?${params}`, token);
      const body = await readJson(response);
      if (!response.ok) await throwApiError(response, body);
      const shifts: Shift[] = body.rows;
      // Column headers and values stay in English (and dates in DD/MM/YYYY), whatever
      // the dashboard language, so exported files keep the same layout.
      const rows = [
        [
          "Worker",
          "Username",
          "Site",
          "Work date",
          `Arrival (${APP_TIMEZONE})`,
          `Paid start (${APP_TIMEZONE})`,
          "Changing/waiting minutes",
          "Lateness minutes",
          `Lunch started (${APP_TIMEZONE})`,
          `Lunch ended (${APP_TIMEZONE})`,
          "Lunch minutes",
          "Break (min)",
          `Work finished (${APP_TIMEZONE})`,
          "Auto-closed",
          "Worked hours",
          "Earned",
        ],
        ...shifts.map((shift) => [
          shift.full_name,
          shift.username,
          shift.building_name || "",
          shift.work_date,
          formatAppDateTime(shift.arrival_at),
          formatAppDateTime(shift.paid_start_at),
          shift.waiting_minutes,
          shift.lateness_minutes,
          formatAppDateTime(shift.lunch_start_time),
          formatAppDateTime(shift.lunch_end_time),
          lunchMinutesOf(shift),
          breakMinutesOf(shift),
          formatAppDateTime(shift.end_work_time),
          shift.auto_closed ? "Yes" : "No",
          Number(shift.total_worked_hours || 0).toFixed(2),
          Number(shift.daily_earned || 0).toFixed(2),
        ]),
      ];
      const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["﻿", content], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `attendance-report-${startDate}-${endDate}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setExportError(errorTextOf(downloadError));
    } finally {
      setExporting(false);
    }
  };

  const searchTooShort = searchInput.trim().length === 1;
  const shownError = error ?? exportError;
  const totalPages = data?.total_pages ?? 1;
  const shownPage = data?.page ?? page;

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-gray-900">{t("report.title")}</h2>
        <p className="mt-1 text-sm text-gray-500">{t("report.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <label className="text-xs font-semibold text-gray-600">
          {t("report.startDate")}
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(event) => {
              datesEdited.current = true;
              setStartDate(event.target.value);
              setPage(1);
            }}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold text-gray-600">
          {t("report.endDate")}
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(event) => {
              datesEdited.current = true;
              setEndDate(event.target.value);
              setPage(1);
            }}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="min-w-0 flex-1 basis-56 text-xs font-semibold text-gray-600">
          {t("report.search")}
          <input
            type="search"
            value={searchInput}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t("report.searchPlaceholder")}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal"
          />
        </label>
        <button
          onClick={() => setRefreshCount((count) => count + 1)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          <RefreshCw size={16} /> {loading ? t("common.loading") : t("report.refresh")}
        </button>
        <button
          onClick={() => void downloadCsv()}
          disabled={exporting || !data?.total_rows}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          <Download size={16} /> {exporting ? t("report.exporting") : t("report.exportCsv")}
        </button>
        <p className="basis-full text-xs text-gray-500">
          {t("report.timezoneNote", { city: APP_TIMEZONE_CITY })}
          {searchTooShort && ` · ${t("report.searchTooShort")}`}
        </p>
      </div>

      {shownError && (
        <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
          {t(shownError.key, shownError.values)}
        </p>
      )}

      <div
        className={`grid gap-4 transition-opacity sm:grid-cols-3 ${loading && data ? "opacity-60" : ""}`}
      >
        <Summary label={t("report.periods")} value={data ? data.totals.periods : "—"} />
        <Summary label={t("report.totalHours")} value={data ? data.totals.hours.toFixed(2) : "—"} />
        <Summary
          label={t("report.totalEarnings")}
          value={data ? `€${data.totals.earnings.toFixed(2)}` : "—"}
        />
      </div>

      <div
        aria-busy={loading}
        className={`overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm transition-opacity ${loading && data ? "opacity-60" : ""}`}
      >
        <table className="min-w-[1640px] w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              {COLUMNS.map((heading) => (
                <th key={heading} className="px-4 py-3 font-semibold">
                  {t(heading)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.rows.map((shift) => (
              <tr key={shift.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium">{shift.full_name}</div>
                  <div className="text-xs text-gray-500">{shift.username}</div>
                </td>
                <td className="px-4 py-3">{shift.building_name || "—"}</td>
                <td className="px-4 py-3">{formatWorkDate(shift.work_date, language)}</td>
                <td className="px-4 py-3">{formatAppDateTime(shift.arrival_at, language)}</td>
                <td className="px-4 py-3">{formatAppDateTime(shift.paid_start_at, language)}</td>
                <td className="px-4 py-3 tabular-nums">{shift.waiting_minutes ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{shift.lateness_minutes ?? "—"}</td>
                <td className="px-4 py-3">{formatAppDateTime(shift.lunch_start_time, language)}</td>
                <td className="px-4 py-3">{formatAppDateTime(shift.lunch_end_time, language)}</td>
                <td className="px-4 py-3 tabular-nums">{lunchMinutesOf(shift) ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{breakMinutesOf(shift) ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatAppDateTime(shift.end_work_time, language)}
                  {shift.auto_closed && <AutoClosedBadge />}
                </td>
                <td className="px-4 py-3">
                  {Number(shift.total_worked_hours || 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 font-medium">
                  €{Number(shift.daily_earned || 0).toFixed(2)}
                </td>
              </tr>
            ))}
            {!data && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-4 py-12 text-center text-gray-500">
                  {loading ? t("report.loadingReport") : t("report.loadFailed")}
                </td>
              </tr>
            )}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-4 py-12 text-center text-gray-500">
                  {search ? t("report.noMatches") : t("report.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total_rows > PAGE_SIZES[0] && (
        <nav
          aria-label={t("report.pagesLabel")}
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600"
        >
          <p>{t("report.rows", { count: data.total_rows })}</p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(shownPage - 1)}
                disabled={loading || shownPage <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50"
              >
                <ChevronLeft size={16} /> {t("report.previous")}
              </button>
              <span className="px-2 tabular-nums">
                {t("report.pageOf", { page: shownPage, total: totalPages })}
              </span>
              <button
                onClick={() => setPage(shownPage + 1)}
                disabled={loading || shownPage >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50"
              >
                {t("report.next")} <ChevronRight size={16} />
              </button>
            </div>
          )}
          <label className="flex items-center gap-2">
            {t("report.rowsPerPage")}
            <select
              value={pageSize}
              disabled={loading}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </nav>
      )}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
