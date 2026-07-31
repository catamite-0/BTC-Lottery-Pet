import type { Dispatch, SetStateAction } from "react";
import type { AppConfig } from "../../miningLogic";

interface PoolSettingsSectionProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  presetPort: (poolHost: string, currentPort: number) => number;
}

export default function PoolSettingsSection({
  draftConfig,
  setDraftConfig,
  presetPort,
}: PoolSettingsSectionProps) {
  return (
    <section id="settings-pool" className="settings-section-card" aria-label="Pool settings">
      <div className="settings-section-heading">
        <p className="eyebrow">POOL</p>
        <strong>Connection identity</strong>
      </div>
      <div className="form-grid">
        <label>
          BTC ADDRESS
          <input
            value={draftConfig.btc_address}
            onChange={(event) => setDraftConfig({ ...draftConfig, btc_address: event.target.value })}
            placeholder="bc1..."
          />
        </label>
        <label>
          POOL HOST
          <input
            list="pool-presets"
            value={draftConfig.pool_host}
            onChange={(event) => {
              const poolHost = event.target.value;
              setDraftConfig({
                ...draftConfig,
                pool_host: poolHost,
                pool_port: presetPort(poolHost, draftConfig.pool_port),
              });
            }}
          />
          <datalist id="pool-presets">
            <option value="public-pool.io" />
            <option value="pool.nerdminer.io" />
            <option value="pool.nerdminers.org" />
          </datalist>
        </label>
        <label>
          PORT
          <input
            type="number"
            value={draftConfig.pool_port}
            onChange={(event) => setDraftConfig({ ...draftConfig, pool_port: Number(event.target.value) })}
          />
        </label>
        <label>
          WORKER
          <input
            value={draftConfig.worker_name}
            onChange={(event) => setDraftConfig({ ...draftConfig, worker_name: event.target.value })}
          />
        </label>
        <label className="full-width">
          POOL PASSWORD / HINT
          <input
            type="password"
            autoComplete="off"
            value={draftConfig.pool_password}
            onChange={(event) => setDraftConfig({ ...draftConfig, pool_password: event.target.value })}
            placeholder="x or d=1"
          />
        </label>
      </div>
    </section>
  );
}
