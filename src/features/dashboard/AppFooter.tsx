interface AppFooterProps {
  poolStatus: string;
  engineStatus: string;
  effectiveCpuThreads: number;
}

export default function AppFooter({
  poolStatus,
  engineStatus,
  effectiveCpuThreads,
}: AppFooterProps) {
  return (
    <footer className="app-footer">
      <span className="dot armed" />
      <span title={engineStatus}>{engineStatus}</span>
      <span title={poolStatus}>{poolStatus}</span>
      <span className="cpu">{effectiveCpuThreads} CPU thread{effectiveCpuThreads === 1 ? "" : "s"}</span>
    </footer>
  );
}
