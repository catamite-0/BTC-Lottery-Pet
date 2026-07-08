import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { AppConfig, RealMiningStats } from "../../miningLogic";
import { formatDifficulty } from "../../miningLogic";
import { derivePetCompanionSnapshot } from "../../pets/companion";
import { builtinPetProfiles, type PetProfile } from "../../pets/profiles";
import PetDisplay from "../pet/PetDisplay";

type PetOptionStyle = CSSProperties & { [key: `--${string}`]: string };

interface PetSettingsSectionProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
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

function petOptionStyle(profile: PetProfile): PetOptionStyle {
  return {
    "--pet-option-primary": profile.palette.primary,
    "--pet-option-secondary": profile.palette.secondary,
    "--pet-option-glow": profile.palette.primary,
  } as PetOptionStyle;
}

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

function PetProfilePreview({ profile }: { profile: PetProfile }) {
  return (
    <span className="pet-profile-preview-shell" aria-hidden="true">
      <PetProfileDisplay profile={profile} displayMode="compact" />
    </span>
  );
}

export default function PetSettingsSection({
  draftConfig,
  setDraftConfig,
  selectedPetProfile,
}: PetSettingsSectionProps) {
  return (
    <section id="settings-pet" className="pet-settings-panel settings-section-card" aria-label="Pet profile">
      <div className="settings-section-heading">
        <p className="eyebrow">PET PROFILE</p>
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
      <div className="pet-profile-picker">
        {builtinPetProfiles.map((profile) => (
          <button
            aria-pressed={selectedPetProfile.id === profile.id}
            className={`pet-profile-option ${selectedPetProfile.id === profile.id ? "selected" : ""}`}
            key={profile.id}
            onClick={() => setDraftConfig({ ...draftConfig, pet_profile_id: profile.id })}
            style={petOptionStyle(profile)}
            type="button"
          >
            <PetProfilePreview profile={profile} />
            <span className="pet-profile-copy">
              <b>{profile.name}</b>
              <small>{profile.personality.name} / {profile.body.silhouette}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
