export function formatDifficulty(value: number) {
  return value < 1_000
    ? value.toFixed(4)
    : Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatHashrate(hashrate: number) {
  if (hashrate >= 1_000_000) {
    return `${(hashrate / 1_000_000).toFixed(2)} MH/s`;
  }

  if (hashrate >= 1_000) {
    return `${(hashrate / 1_000).toFixed(2)} KH/s`;
  }

  return `${hashrate.toFixed(0)} H/s`;
}

export function expectedSharesPerHour(hashrate: number, shareDifficulty: number) {
  if (!Number.isFinite(hashrate) || !Number.isFinite(shareDifficulty)) {
    return 0;
  }
  if (hashrate <= 0 || shareDifficulty <= 0) {
    return 0;
  }

  return hashrate * 3600 / (shareDifficulty * 2 ** 32);
}

export function formatShareRate(sharesPerHour: number) {
  if (!Number.isFinite(sharesPerHour) || sharesPerHour <= 0) {
    return "Waiting";
  }

  if (sharesPerHour < 0.001) {
    return "<0.001/h";
  }

  if (sharesPerHour < 1) {
    return `${sharesPerHour.toFixed(3)}/h`;
  }

  if (sharesPerHour < 100) {
    return `${sharesPerHour.toFixed(2)}/h`;
  }

  return `${Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(sharesPerHour)}/h`;
}
