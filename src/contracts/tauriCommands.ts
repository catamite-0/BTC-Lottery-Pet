export const TAURI_COMMANDS = {
  getConfig: "get_config",
  saveConfig: "save_config",
  getSystemInfo: "get_system_info",
  startRealMining: "start_real_mining",
  stopRealMining: "stop_real_mining",
  notifyJackpot: "notify_jackpot",
  notifyShareAccepted: "notify_share_accepted",
  notifyConnectionError: "notify_connection_error",
  getLogPath: "get_log_path",
  openLogFolder: "open_log_folder",
  setWindowAlwaysOnTop: "set_window_always_on_top",
} as const;

export const TAURI_EVENTS = {
  miningStats: "mining-stats",
  miningLog: "mining-log",
  miningEvent: "mining-event",
  blockFound: "block-found",
} as const;
