export interface NotificationSettingsPayload {
  enableNotifications: boolean;
  notifyOnJackpot: boolean;
  notifyOnShareAccepted: boolean;
  notifyOnConnectionError: boolean;
}

export interface JackpotNotificationPayload {
  pool: string;
  jobId: string;
  hash: string;
  difficulty: number;
  timestamp: string;
}
