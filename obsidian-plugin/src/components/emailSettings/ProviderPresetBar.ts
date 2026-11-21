import { PROVIDER_PRESETS, type MailProviderPreset } from "../../../../shared/types";

export function renderProviderPresetBar(params: {
  wrapper: HTMLElement;
  activeProvider: MailProviderPreset;
  onSelectPreset: (preset: MailProviderPreset) => Promise<void>;
}): void {
  const { wrapper, activeProvider, onSelectPreset } = params;
  const presetRow = wrapper.createDiv({ cls: "tl-preset-row" });
  const order: MailProviderPreset[] = ["roundcube", "gmail", "outlook", "custom"];

  for (const presetId of order) {
    const spec = PROVIDER_PRESETS[presetId];
    const isActive = activeProvider === presetId;
    const btn = presetRow.createEl("button", {
      text: spec.label,
      type: "button",
      cls: `tl-preset-btn${isActive ? " is-active" : ""}`,
    });
    btn.addEventListener("click", () => {
      void onSelectPreset(presetId);
    });
  }

  const activeSpec = PROVIDER_PRESETS[activeProvider] || PROVIDER_PRESETS.roundcube;
  wrapper.createDiv({
    cls: "tl-info-box",
    text: activeSpec.description,
  });
}
