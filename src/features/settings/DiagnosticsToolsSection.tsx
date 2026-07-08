import type { PoolDiagnosticReport } from "../../miningLogic";

interface DiagnosticsToolsSectionProps {
  runPoolDiagnostic: () => Promise<void>;
  poolDiagnosticResult: PoolDiagnosticReport | null;
}

export default function DiagnosticsToolsSection({
  runPoolDiagnostic,
  poolDiagnosticResult,
}: DiagnosticsToolsSectionProps) {
  return (
    <section
      id="settings-diagnostics"
      className="diagnostics-settings-panel settings-section-card"
      aria-label="Diagnostics tools"
    >
      <div className="settings-section-heading">
        <p className="eyebrow">TOOLS</p>
        <strong>Benchmarks and connection diagnostics</strong>
      </div>
      <div className="benchmark-row">
        <div className="settings-tool-actions">
          <button className="secondary-button" onClick={() => void runPoolDiagnostic()} type="button">TEST POOL</button>
        </div>
        {poolDiagnosticResult && (
          <div className="pool-diagnostic-result" aria-label="Pool diagnostic result">
            <div className="pool-diagnostic-summary"><span>{poolDiagnosticResult.pool}</span><strong>{poolDiagnosticResult.summary}</strong></div>
            {poolDiagnosticResult.steps.map((step) => (
              <div className={`pool-diagnostic-step ${step.status}`} key={`${step.name}-${step.status}`}>
                <span>{step.name}</span><b>{step.status}</b><p>{step.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
