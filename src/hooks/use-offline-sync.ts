"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOfflineQueueStats,
  subscribeOfflineQueue,
} from "@/lib/offline/queue";
import { syncOfflineQueue } from "@/lib/offline/sync";

const SYNC_INTERVAL_MS = 15000;

function readOnlineState() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(readOnlineState);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [stats, setStats] = useState(getOfflineQueueStats);

  const refreshStats = useCallback(() => {
    setStats(getOfflineQueueStats());
  }, []);

  const runSync = useCallback(async () => {
    if (!readOnlineState()) {
      refreshStats();
      return;
    }

    setIsSyncing(true);
    try {
      await syncOfflineQueue();
      setLastSyncAt(new Date().toISOString());
    } finally {
      setIsSyncing(false);
      refreshStats();
    }
  }, [refreshStats]);

  useEffect(() => {
    refreshStats();
    const unsubscribe = subscribeOfflineQueue(refreshStats);
    return unsubscribe;
  }, [refreshStats]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      runSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshStats();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshStats, runSync]);

  useEffect(() => {
    if (!isOnline) return;

    const timer = window.setInterval(() => {
      const current = getOfflineQueueStats();
      if (current.pending > 0) {
        runSync();
      } else {
        refreshStats();
      }
    }, SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isOnline, refreshStats, runSync]);

  useEffect(() => {
    if (!readOnlineState()) return;
    if (getOfflineQueueStats().pending === 0) return;
    runSync();
  }, [runSync]);

  return {
    isOnline,
    isSyncing,
    lastSyncAt,
    pendingCount: stats.pending,
    failedCount: stats.failed,
    totalCount: stats.total,
    runSync,
    refreshStats,
  };
}
