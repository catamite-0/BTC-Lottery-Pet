import type { HeartbeatInterval, NotificationChannel } from "./config";

export interface NotificationSettingsPayload {
  enableNotifications: boolean;
  notifyOnJackpot: boolean;
  notifyOnShareAccepted: boolean;
  notifyOnConnectionError: boolean;
  heartbeatInterval: HeartbeatInterval;
  notificationChannel: NotificationChannel;
  webhookUrl: string;
}

export interface JackpotNotificationPayload {
  pool: string;
  jobId: string;
  hash: string;
  difficulty: number;
  timestamp: string;
}

export interface HeartbeatNotificationSnapshot {
  status: string;
  hashrate: number;
  acceptedShares: number;
  rejectedShares: number;
  bestDifficulty: number;
  uptime: string;
  pool: string;
}
