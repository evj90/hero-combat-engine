/**
 * Attack Sheet Tooltips
 * Enriches attack/power tooltips in the HERO System character sheet Attacks tab
 * with dice formulas, power names, and relevant descriptions.
 */

function stripHtmlTags(html) {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

function getAttackDiceFormula(item) {
  const sys = item.system ?? {};
  
  // Common HERO System paths for damage/dice
  const candidates = [
    sys.damage?.formula,
    sys.diceFormula,
    sys.formula,
    sys.dice,
    sys.damageFormula
  ];
  
  return candidates.find(v => v && typeof v === "string") || "";
}

function getAttackDescription(item) {
  const sys = item.system ?? {};
  let desc = "";
  
  // Try various description/notes fields
  if (sys.description) {
    desc = typeof sys.description === "string" ? sys.description : sys.description.value || "";
  } else if (sys.notes) {
    desc = typeof sys.notes === "string" ? sys.notes : sys.notes.value || "";
  } else if (sys.summary) {
    desc = typeof sys.summary === "string" ? sys.summary : sys.summary.value || "";
  }
  
  return stripHtmlTags(desc).substring(0, 100);
}

function getAttackType(item) {
  const sys = item.system ?? {};
  const type = item.type || "";
  
  // Infer power type from item properties
  if (type === "power" || sys.isPower) return "Power";
  if (type === "maneuver" || sys.isManeuver) return "Maneuver";
  if (type === "attack" || type === "weapon") return "Attack";
  if (sys.type === "attack") return "Attack";
  
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function buildAttackTooltip(item) {
  if (!item) return "";
  
  const name = item.name || "Unknown";
  const type = getAttackType(item);
  const dice = getAttackDiceFormula(item);
  const desc = getAttackDescription(item);
  
  let tooltip = `${name} (${type})`;
  
  if (dice) {
    tooltip += ` — ${dice}`;
  }
  
  if (desc) {
    tooltip += ` — ${desc}`;
  }
  
  return tooltip;
}

function enrichAttackSheetTooltips(app, html, data) {
  // Find the Attacks tab and its rows
  const attacksTab = html.find('div[data-tab="attacks"]');
  if (!attacksTab.length) return;
  
  // Look for attack rows (typically tables or list items with data-item-id)
  const attackRows = attacksTab.find('[data-item-id]').closest('tr, .item-row, li[data-item-id]');
  
  attackRows.each((i, row) => {
    const itemId = row.dataset.itemId;
    if (!itemId) return;
    
    const item = app.object?.items?.get(itemId);
    if (!item) return;
    
    const tooltip = buildAttackTooltip(item);
    if (!tooltip) return;
    
    // Apply tooltip to the row or first interactive element
    const nameCell = row.querySelector('a[data-item-id], td:first-child, .item-name');
    if (nameCell) {
      nameCell.title = tooltip;
    } else {
      row.title = tooltip;
    }
  });
}

export function registerAttackSheetTooltips() {
  Hooks.on("renderActorSheet", (app, html, data) => {
    try {
      enrichAttackSheetTooltips(app, html, data);
    } catch (err) {
      console.error("HERO Combat Engine | error enriching attack tooltips:", err);
    }
  });
}
