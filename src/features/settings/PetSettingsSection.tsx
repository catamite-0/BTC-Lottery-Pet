import type { RealMiningStats } from "../../miningLogic";
import { formatDifficulty } from "../../miningLogic";
import { derivePetCompanionSnapshot } from "../../pets/companion";
import type { PetProfile } from "../../pets/profiles";
import PetDisplay from "../pet/PetDisplay";

interface PetSettingsSectionProps {
  selectedPetProfile: PetProfile;
}

const previewStats: RealMiningStats = {
  session_id: 0,
  hashrate: 0,
  accepted_shares: 0,
  rejected_shares: 0,
  stale_shares_dropped: 0,
  queued_shares_dropped: 0,
  best_difficulty: 0,
  share_difficulty: 0,
  current_job_id: "",
  connection_status: "Stopped",
};

function PetProfileDisplay({
  profile,
  displayMode,
}: {
  profile: PetProfile;
  displayMode: "compact" | "detail";
}) {
  const companion = derivePetCompanionSnapshot({
    profile,
    petState: "IDLE",
    petStatus: "Sleeping",
    isMining: false,
    connectionStatus: "Stopped",
    latestLog: "Preview",
    lastEvent: null,
    acceptedShares: 0,
    rejectedShares: 0,
    bestDifficulty: 0,
    hashrate: 0,
    luckMeter: 0,
    miningUptimeSeconds: 0,
    appUptimeSeconds: 0,
  });

  return (
    <PetDisplay
      petProfile={profile}
      companion={companion}
      petStatus="Sleeping"
      isMiningAnimation={false}
      displayMode={displayMode}
      compactRuntimeLabel="CPU"
      displayedHashrate="Preview"
      realStats={previewStats}
      blockHeight=""
      formatDifficulty={formatDifficulty}
    />
  );
}

export default function PetSettingsSection({
  selectedPetProfile,
}: PetSettingsSectionProps) {
  return (
    <section id="settings-pet" className="pet-settings-panel settings-section-card" aria-label="Pet profile">
      <div className="settings-section-heading">
        <p className="eyebrow">PET</p>
        <strong>{selectedPetProfile.name}</strong>
      </div>
      <div className="pet-settings-showcase">
        <PetProfileDisplay profile={selectedPetProfile} displayMode="detail" />
        <div className="pet-profile-summary">
          <span>{selectedPetProfile.personality.name}</span>
          <b>{selectedPetProfile.personality.species}</b>
          <small>{selectedPetProfile.personality.trait} / {selectedPetProfile.body.silhouette}</small>
        </div>
      </div>
    </section>
  );
}
