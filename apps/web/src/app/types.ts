export type PrimaryView =
  "overview" | "assets" | "activity" | "invoices" | "settings";

export type DetailView = "bank" | "cards" | "investments" | "manual-assets";

export type MobileSettingsView =
  "data-sources" | "exchange-rates" | "classification-rules";

export type View = PrimaryView | DetailView | MobileSettingsView | "more";

export interface RuntimeInfo {
  demoMode: boolean;
}
