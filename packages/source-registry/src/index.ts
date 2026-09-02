import type { SourceDefinition } from "@data-hub/contracts";

import {
  HCP_IPC_2017_SOURCE,
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_OFFICIAL_G2_SOURCE,
  HCP_IPP_2018_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
} from "./hcp.js";

export {
  HCP_IPC_2017_SOURCE,
  HCP_IPC_2017_OFFICIAL_G1_SOURCE,
  HCP_IPC_2017_OFFICIAL_G2_SOURCE,
  HCP_IPP_2018_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G1_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G2_SOURCE,
  HCP_IPPI_2018_OFFICIAL_G3_SOURCE,
  HCP_LOCATION_KEYS,
} from "./hcp.js";

const SOURCES = new Map<string, SourceDefinition>([
  [HCP_IPC_2017_SOURCE.source_id, HCP_IPC_2017_SOURCE],
  [HCP_IPC_2017_OFFICIAL_G1_SOURCE.source_id, HCP_IPC_2017_OFFICIAL_G1_SOURCE],
  [HCP_IPC_2017_OFFICIAL_G2_SOURCE.source_id, HCP_IPC_2017_OFFICIAL_G2_SOURCE],
  [HCP_IPP_2018_SOURCE.source_id, HCP_IPP_2018_SOURCE],
  [HCP_IPPI_2018_OFFICIAL_G1_SOURCE.source_id, HCP_IPPI_2018_OFFICIAL_G1_SOURCE],
  [HCP_IPPI_2018_OFFICIAL_G2_SOURCE.source_id, HCP_IPPI_2018_OFFICIAL_G2_SOURCE],
  [HCP_IPPI_2018_OFFICIAL_G3_SOURCE.source_id, HCP_IPPI_2018_OFFICIAL_G3_SOURCE],
]);

export function getSourceDefinition(sourceId: string): SourceDefinition {
  const source = SOURCES.get(sourceId);
  if (!source) {
    throw new Error(`unknown_source:${sourceId}`);
  }
  return source;
}

export function listEnabledSourceDefinitions(): SourceDefinition[] {
  return [...SOURCES.values()]
    .filter((source) => source.enabled && source.access_mode !== "disabled")
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}
