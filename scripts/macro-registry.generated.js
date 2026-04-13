// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run: node tools/build-macro-registry.mjs

import * as macro_1_Full_Health_js from "./macros/Full Health.js";
import * as macro_2_Grapple_js from "./macros/Grapple.js";
import * as macro_3_recover_js from "./macros/recover.js";
import * as macro_4_Remove_Status_Effects_js from "./macros/Remove Status Effects.js";
import * as macro_5_Rotate_CW_js from "./macros/Rotate CW.js";
import * as macro_6_Set_Upright_js from "./macros/Set Upright.js";

export const macroRegistry = {
  "Full Health": macro_1_Full_Health_js,
  "Grapple": macro_2_Grapple_js,
  "recover": macro_3_recover_js,
  "Remove Status Effects": macro_4_Remove_Status_Effects_js,
  "Rotate CW": macro_5_Rotate_CW_js,
  "Set Upright": macro_6_Set_Upright_js,
};

export async function runRegisteredMacro(name, ...args) {
  const mod = macroRegistry[name];
  if (!mod) throw new Error(`Unknown HERO macro: ${name}`);
  const fn = mod.run ?? mod.default ?? mod.execute;
  if (typeof fn !== "function") {
    throw new Error(`Macro module '${name}' must export run(), default, or execute().`);
  }
  return await fn(...args);
}
