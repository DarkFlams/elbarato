"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeOfflineQueue } from "@/lib/offline/queue";
import {
  getSyncQueueStatsLocalFirst,
  isDesktopSyncQueueEnabled,
} from "@/lib/local/sync-queue";
import { syncOfflineQueue } from "@/lib/offline/sync";
import { syncDesktopQueue } from "@/lib/local/desktop-sync";

const SYNC_INTERVAL_MS = 5000;
const DESKTOP_STATS_POLL_MS = 3000;

function readOnlineState() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(readOnlineState);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, failed: 0 });
  const isDesktopQueue = isDesktopSyncQueueEnabled();
  const syncSupported = true;

  const refreshStats = useCallback(async () => {
    setStats(await getSyncQueueStatsLocalFirst());
  }, []);

  const runSync = useCallback(async () => {
    if (!readOnlineState()) {
      await refreshStats();
      return;
    }

    setIsSyncing(true);
    try {
      if (isDesktopQueue) {
        await syncDesktopQueue();
      } else {
        await syncOfflineQueue();
      }

      setLastSyncAt(new Date().toISOString());
    } finally {
      setIsSyncing(false);
      await refreshStats();
    }
  }, [isDesktopQueue, refreshStats]);

  useEffect(() => {
    void refreshStats();
    if (isDesktopQueue) {
      const timer = window.setInterval(() => {
        void refreshStats();
      }, DESKTOP_STATS_POLL_MS);

      return () => window.clearInterval(timer);
    }

    const unsubscribe = subscribeOfflineQueue(() => {
      void refreshStats();
    });
    return unsubscribe;
  }, [isDesktopQueue, refreshStats]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      runSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      void refreshStats();
    };
    const handleFocus = () => {
      if (!readOnlineState()) return;
      void runSync();
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!readOnlineState()) return;
      void runSync();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshStats, runSync]);

  useEffect(() => {
    if (!isOnline) return;

    const timer = window.setInterval(() => {
      void getSyncQueueStatsLocalFirst().then((current) => {
        if (current.pending > 0) {
          void runSync();
        } else {
          void refreshStats();
        }
      });
    }, SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isOnline, refreshStats, runSync]);

  useEffect(() => {
    if (!readOnlineState()) return;
    void getSyncQueueStatsLocalFirst().then((current) => {
      if (current.pending === 0) return;
      void runSync();
    });
  }, [runSync]);

  return {
    isOnline,
    isSyncing,
    lastSyncAt,
    syncSupported,
    pendingCount: stats.pending,
    failedCount: stats.failed,
    totalCount: stats.total,
    runSync,
    refreshStats,
  };
}
