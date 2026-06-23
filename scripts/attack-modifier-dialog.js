/**
 * Attack Modifier Dialog
 *
 * Opens a popup that lets the user select situational modifiers and a
 * custom OCV/DCV delta, then applies the net result as a
 * temporary cvSegmentMod on the token — the same schema used by the existing
 * CV modifier system, so expiration is handled for free.
 */

// ── Status effect definitions (mirrors HERO_QUICK_STATUSES in controller-panel.js) ──
const STATUS_OCV_DCV = {
  prone: { ocv: -2, dcv: -2, label: "Prone: −2 OCV, −2 DCV" },
  blind: { ocv: -4, dcv:  0, label: "Flashed (Sight): −4 OCV" },
  deaf:  { ocv:  0, dcv:  0, label: "Flashed (Hearing): no direct CV penalty" }
};

// ── Helpers (self-contained copies so we have no cross-module dependency) ──

function _absSegIdx(phase, segment) {
  return ((Math.max(1, Number(phase ?? 1)) - 1) * 12)
    + Math.min(12, Math.max(1, Number(segment ?? 1)));
}

function _createModEntry(statMods, segments, phase, segment) {
  const duration  = Math.max(1, Number(segments ?? 1));
  const applyIdx  = _absSegIdx(phase, segment);
  const expireIdx = applyIdx + duration;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    statMods,
    remainingSegments: duration,
    appliedPhase:   Number(phase   ?? 1),
    appliedSegment: Number(segment ?? 1),
    expirePhase:    Math.floor((expireIdx - 1) / 12) + 1,
    expireSegment:  ((expireIdx - 1) % 12) + 1
  };
}

function _charUpdateData(actor, statKey, delta) {
  if (!delta) return {};

  if (statKey === "mcv") {
    const chars   = actor.system?.characteristics ?? {};
    const updates = {};
    if (chars.mcv?.value  != null) { updates["system.characteristics.mcv.value"]  = (chars.mcv.value  ?? 0) + delta; return updates; }
    if (chars.dmcv?.value != null)   updates["system.characteristics.dmcv.value"] = (chars.dmcv.value ?? 0) + delta;
    if (chars.omcv?.value != null)   updates["system.characteristics.omcv.value"] = (chars.omcv.value ?? 0) + delta;
    if (Object.keys(updates).length) return updates;
    updates["system.characteristics.mcv.value"] = delta;
    return updates;
  }

  const chars = actor.system?.characteristics ?? {};
  return { [`system.characteristics.${statKey}.value`]: (chars?.[statKey]?.value ?? 0) + delta };
}

function _signStr(n) {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function _getEnabledSituationalIdSet() {
  const raw = game.settings.get("hero-combat-engine", "attackSituationalEnabledIds") ?? "__ALL__";
  if (raw === "__ALL__") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter(id => typeof id === "string" && id.length));
  } catch {
    return null;
  }
}

// ── Load attack modifiers (default + GM custom) ──────────────────────────────

async function _loadModifiers() {
  let defaults = [];
  try {
    const modPath = game.modules.get("hero-combat-engine")?.path ?? "modules/hero-combat-engine";
    const resp = await fetch(`${modPath}/data/attack-modifiers.json`);
    if (resp.ok) defaults = await resp.json();
  } catch (err) {
    console.warn("HERO Combat Engine | failed to load attack-modifiers.json", err);
  }

  let custom = [];
  try {
    const raw = game.settings.get("hero-combat-engine", "attackModifiers") ?? "[]";
    custom = JSON.parse(raw);
    if (!Array.isArray(custom)) custom = [];
  } catch {
    custom = [];
  }

  // Merge: custom entries override defaults by id; new ids are appended.
  const map = new Map(defaults.map(m => [m.id, m]));
  for (const c of custom) {
    if (c?.id) map.set(c.id, { ...map.get(c.id), ...c });
  }
  return [...map.values()];
}

// ── Build dialog HTML ────────────────────────────────────────────────────────

function _buildDialogContent(token, modifiers, activeStatuses) {
  const enabledSituationalIds = _getEnabledSituationalIdSet();
  const situational  = modifiers
    .filter(m => m.category === "situational")
    .filter(m => enabledSituationalIds === null || enabledSituationalIds.has(m.id));
  const customCats   = [...new Set(modifiers.filter(m => m.category !== "maneuver" && m.category !== "situational").map(m => m.category))];

  // ── Situational (checkboxes, multi-select) ──
  const situationalRows = situational.map(m => {
    const ocvStr = m.ocvMod !== 0 ? `OCV ${_signStr(m.ocvMod)}` : "";
    const dcvStr = m.dcvMod !== 0 ? `DCV ${_signStr(m.dcvMod)}` : "";
    const deltaText = [ocvStr, dcvStr].filter(Boolean).join(", ");
    const deltaHtml = deltaText
      ? `<span class="atk-mod-delta ${m.ocvMod < 0 || m.dcvMod < 0 ? "atk-mod-neg" : "atk-mod-pos"}">${deltaText}</span>`
      : "";
    return `<label class="atk-mod-row" title="${m.description ?? ""}">
      <input type="checkbox" class="atk-situational-cb" data-ocv="${m.ocvMod ?? 0}" data-dcv="${m.dcvMod ?? 0}"/>
      <span class="atk-mod-name">${m.name}</span>
      ${deltaHtml}
      <span class="atk-mod-desc">${m.description ?? ""}</span>
    </label>`;
  }).join("");

  // ── Custom category rows (from GM-added non-standard categories) ──
  const customSections = customCats.map(cat => {
    const items = modifiers.filter(m => m.category === cat);
    const rows = items.map(m => {
      const ocvStr = m.ocvMod !== 0 ? `OCV ${_signStr(m.ocvMod)}` : "";
      const dcvStr = m.dcvMod !== 0 ? `DCV ${_signStr(m.dcvMod)}` : "";
      const deltaText = [ocvStr, dcvStr].filter(Boolean).join(", ");
      const deltaHtml = deltaText
        ? `<span class="atk-mod-delta ${m.ocvMod < 0 || m.dcvMod < 0 ? "atk-mod-neg" : "atk-mod-pos"}">${deltaText}</span>`
        : "";
      return `<label class="atk-mod-row" title="${m.description ?? ""}">
        <input type="checkbox" class="atk-situational-cb" data-ocv="${m.ocvMod ?? 0}" data-dcv="${m.dcvMod ?? 0}"/>
        <span class="atk-mod-name">${m.name}</span>
        ${deltaHtml}
        <span class="atk-mod-desc">${m.description ?? ""}</span>
      </label>`;
    }).join("");
    const heading = cat.charAt(0).toUpperCase() + cat.slice(1);
    return `<fieldset class="atk-mod-section">
      <legend>${heading}</legend>
      ${rows}
    </fieldset>`;
  }).join("");

  // ── Active Status Effects (informational) ──
  let statusSection = "";
  if (activeStatuses.length) {
    const badges = activeStatuses.map(s => {
      const impact = STATUS_OCV_DCV[s.id];
      return `<span class="atk-status-badge" title="${s.label}">
        <img src="${s.icon}" width="12" height="12"/> ${s.label}
        ${impact ? `<em>(${impact.label})</em>` : ""}
      </span>`;
    }).join("");
    statusSection = `<fieldset class="atk-mod-section">
      <legend>Active Status Effects <span class="atk-mod-legend-note">(informational — already applied to token)</span></legend>
      <div class="atk-status-badges">${badges}</div>
    </fieldset>`;
  }

  return `<div class="atk-mod-dialog">
    <p class="atk-mod-hint">Select modifiers for the next attack. Apply adds a temporary CV modifier to this token for the chosen number of segments.</p>

    <fieldset class="atk-mod-section">
      <legend>Situational Modifiers <span class="atk-mod-legend-note">(select all that apply)</span></legend>
      <div class="atk-mod-scroll">${situationalRows}</div>
    </fieldset>

    ${customSections}
    ${statusSection}

    <fieldset class="atk-mod-section">
      <legend>Custom</legend>
      <div class="atk-mod-custom-row">
        <label>OCV <input type="number" id="atk-custom-ocv" class="atk-custom-input" value="0" min="-20" max="20"/></label>
        <label>DCV <input type="number" id="atk-custom-dcv" class="atk-custom-input" value="0" min="-20" max="20"/></label>
      </div>
    </fieldset>

    <div class="atk-mod-footer">
      <div class="atk-mod-net">
        Net: OCV <strong id="atk-net-ocv">+0</strong> / DCV <strong id="atk-net-dcv">+0</strong>
      </div>
      <div class="atk-mod-duration">
        <label>Duration (segments) <input type="number" id="atk-segments" class="atk-custom-input" value="1" min="1" max="999"/></label>
      </div>
    </div>
  </div>`;
}

// ── Net calculation ──────────────────────────────────────────────────────────

function _calcNet(html) {
  let ocv = 0;
  let dcv = 0;

  html.find(".atk-situational-cb:checked").each((_, el) => {
    ocv += parseInt(el.dataset.ocv ?? 0) || 0;
    dcv += parseInt(el.dataset.dcv ?? 0) || 0;
  });

  ocv += parseInt(html.find("#atk-custom-ocv").val() ?? 0) || 0;
  dcv += parseInt(html.find("#atk-custom-dcv").val() ?? 0) || 0;

  return { ocv, dcv };
}

function _updateNetDisplay(html) {
  const { ocv, dcv } = _calcNet(html);
  const ocvEl = html.find("#atk-net-ocv");
  const dcvEl = html.find("#atk-net-dcv");

  ocvEl.text(_signStr(ocv)).toggleClass("atk-net-pos", ocv > 0).toggleClass("atk-net-neg", ocv < 0).toggleClass("atk-net-zero", ocv === 0);
  dcvEl.text(_signStr(dcv)).toggleClass("atk-net-pos", dcv > 0).toggleClass("atk-net-neg", dcv < 0).toggleClass("atk-net-zero", dcv === 0);
}

// ── Main exported function ───────────────────────────────────────────────────

export async function openAttackModifierDialog(tokenId) {
  const token = canvas.tokens.get(tokenId);
  const actor = token?.actor;
  if (!token || !actor) return;

  if (!game.user.isGM && !token.document?.canUserModify?.(game.user, "update")) return;

  const modifiers = await _loadModifiers();

  // Collect active quick statuses for informational display
  const activeStatuses = (() => {
    const activeIDs = actor.statuses
      ?? new Set(actor.effects.flatMap(e => [...(e.statuses ?? [])]));
    const cfgMap = Object.fromEntries((CONFIG.statusEffects ?? []).map(s => [s.id, s]));
    return ["prone", "blind", "deaf"].filter(id => activeIDs.has(id)).map(id => ({
      id,
      label: cfgMap[id]?.label ?? id,
      icon:  cfgMap[id]?.icon  ?? `icons/svg/${id}.svg`
    }));
  })();

  const content = _buildDialogContent(token, modifiers, activeStatuses);

  const result = await new Promise(resolve => {
    new Dialog({
      title: `Attack Modifiers — ${token.name}`,
      content,
      buttons: {
        apply: {
          icon:  '<i class="fas fa-crosshairs"></i>',
          label: "Apply",
          callback: html => {
            const { ocv, dcv } = _calcNet(html);
            const segments = Math.max(1, parseInt(html.find("#atk-segments").val()) || 1);

            const statMods = {};
            if (ocv) statMods.ocv = ocv;
            if (dcv) statMods.dcv = dcv;

            resolve({ statMods, segments });
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "apply",
      render: html => {
        html.find(".atk-situational-cb, #atk-custom-ocv, #atk-custom-dcv")
          .on("change input", () => _updateNetDisplay(html));
        _updateNetDisplay(html);
      }
    }, { width: 420 }).render(true);
  });

  if (!result) return;

  const { statMods, segments } = result;

  if (!Object.keys(statMods).length) {
    ui.notifications.info("No net modifier — nothing applied.");
    return;
  }

  const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

  // Apply stat changes to the actor (so the tracker reflects them immediately
  // and cvSegmentModifierTick can revert them when the modifier expires).
  const updates = {};
  for (const [statKey, delta] of Object.entries(statMods)) {
    Object.assign(updates, _charUpdateData(actor, statKey, delta));
  }
  if (Object.keys(updates).length) await actor.update(updates);

  const activeMods = token.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
  const newEntry   = _createModEntry(statMods, segments, phase, segment);
  await token.document.setFlag("hero-combat-engine", "cvSegmentMods", [...activeMods, newEntry]);

  const parts = Object.entries(statMods)
    .map(([k, v]) => `${k.toUpperCase()} ${_signStr(v)}`).join(", ");

  ChatMessage.create({
    speaker: { alias: `HERO Combat | ${phase}.${segment}` },
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    content: `<strong>${token.name}</strong> attack modifier applied: ${parts} for ${segments} segment${segments === 1 ? "" : "s"}.`
  });

  // Re-render the tracker panel if it is open.
  if (game.heroCombat?.heroControllerPanel?.rendered) {
    await game.heroCombat.heroControllerPanel.render(true);
  }
}
