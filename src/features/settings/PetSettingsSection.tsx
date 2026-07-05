import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { AppConfig } from "../../miningLogic";
import { builtinPetProfiles, type PetProfile } from "../../pets/profiles";

type PetOptionStyle = CSSProperties & { [key: `--${string}`]: string };

interface PetSettingsSectionProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  selectedPetProfile: PetProfile;
}

function petOptionStyle(primary: string, secondary: string): PetOptionStyle {
  return {
    "--pet-option-primary": primary,
    "--pet-option-secondary": secondary,
    "--pet-option-glow": primary,
  } as PetOptionStyle;
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
      <div className="pet-profile-summary">
        <span>{selectedPetProfile.personality.name}</span>
        <b>{selectedPetProfile.personality.species}</b>
        <small>{selectedPetProfile.personality.trait} / {selectedPetProfile.body.silhouette}</small>
      </div>
      <div className="pet-profile-picker">
        {builtinPetProfiles.map((profile) => (
          <button
            className={`pet-profile-option ${selectedPetProfile.id === profile.id ? "selected" : ""}`}
            key={profile.id}
            onClick={() => setDraftConfig({ ...draftConfig, pet_profile_id: profile.id })}
            style={petOptionStyle(profile.palette.primary, profile.palette.secondary)}
            type="button"
          >
            <span className="pet-swatch" aria-hidden="true" />
            <span>
              <b>{profile.name}</b>
              <small>{profile.personality.name} / {profile.body.silhouette}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
