// AppearancePane — the Settings "Appearance" section (theme selection).

import { useAuraTheme } from "../../../theme/AuraProvider";
import { NAMED_THEMES } from "../../../theme/tokens";

export function AppearancePane() {
  const { theme, themes, setTheme } = useAuraTheme();

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Appearance</h3>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 14, minWidth: 60 }}>Theme</span>
        <select
          className="harmony-input"
          style={{ maxWidth: 280 }}
          tabIndex={0}
          value={theme.className}
          onChange={(e) => {
            const val = e.target.value;
            if (val) setTheme(val);
          }}
        >
          {themes.map((t) => (
            <option key={t.className} value={t.className}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        The selected theme persists across restarts. Changing it takes effect
        immediately.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {NAMED_THEMES.map((t) => (
          <button
            key={t.className}
            tabIndex={0}
            onClick={() => setTheme(t.className)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border:
                theme.className === t.className
                  ? "2px solid var(--aura-primary)"
                  : "2px solid var(--aura-border)",
              background:
                theme.className === t.className
                  ? "var(--aura-primary)"
                  : "var(--aura-surface-2)",
              color:
                theme.className === t.className
                  ? "var(--aura-on-primary)"
                  : "var(--aura-on-surface)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
