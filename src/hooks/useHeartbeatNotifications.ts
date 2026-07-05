import { useEffect } from "react";
import { formatUptime } from "../formatting";
import {
  heartbeatIntervalMs,
  notificationSettingsFromConfig,
} from "../notificationSettings";
import type { AppConfig, RealMiningStats } from "../miningLogic";
import { sendHeartbeatNotification } from "../platform/tauri/notificationClient";

interface LatestRef<T> {
  current: T;
}

interface UseHeartbeatNotificationsArgs {
  config: AppConfig;
  configRef: LatestRef<AppConfig>;
  realStatsRef: LatestRef<RealMiningStats>;
  appUptimeRef: LatestRef<number>;
  miningUptimeRef: LatestRef<number>;
  isMiningRef: LatestRef<boolean>;
}

export function useHeartbeatNotifications({
  config,
  configRef,
  realStatsRef,
  appUptimeRef,
  miningUptimeRef,
  isMiningRef,
}: UseHeartbeatNotificationsArgs) {
  // Heartbeat notifications are deliberately coarse-grained to avoid spam.
  useEffect(() => {
    const intervalMs = heartbeatIntervalMs(config.heartbeat_interval);
    if (!config.enable_notifications || intervalMs === null) {
      return;
    }

    const sendHeartbeat = () => {
      const currentConfig = configRef.current;
      const currentRealStats = realStatsRef.current;
      const running = isMiningRef.current;
      const uptimeSeconds = running ? miningUptimeRef.current : appUptimeRef.current;

      void sendHeartbeatNotification(notificationSettingsFromConfig(currentConfig), {
        status: running ? currentRealStats.connection_status : "Sleeping",
        hashrate: currentRealStats.hashrate,
        acceptedShares: currentRealStats.accepted_shares,
        rejectedShares: currentRealStats.rejected_shares,
        bestDifficulty: currentRealStats.best_difficulty,
        uptime: formatUptime(uptimeSeconds),
        pool: `${currentConfig.pool_host}:${currentConfig.pool_port}`,
      }).catch(() => {});
    };

    const timer = window.setInterval(sendHeartbeat, intervalMs);
    return () => window.clearInterval(timer);
  }, [config.enable_notifications, config.heartbeat_interval]);
}
