// Stats box data for the gear modification screen (stats.js does the maths). Like the game, changes
// ("+10", "-2  10") are shown only while an upgrade or an overclock is hovered (previewed).

import { computeStats, compareStats } from "./stats.js";

// item, chosen (one option or null per tier), oc (equipped overclock or null);
// next: the previewed { chosen, oc }, or null for the plain panel.
export function statsOf(item, chosen, oc, next = null) {
  if (next) return compareStats(item, { chosen, oc }, next);
  const r = computeStats(item, chosen, oc);
  if (!r) return null;
  r.rows = r.rows.map((x) => ({ ...x, delta: null, better: null }));
  return r;
}
