import type { SourceDefinition } from "@data-hub/contracts";

import {
  HCP_IPC_2017_SOURCE,
  HCP_IPP_2018_SOURCE,
} from "./hcp.js";

export {
  HCP_IPC_2017_SOURCE,
  HCP_IPP_2018_SOURCE,
  HCP_LOCATION_KEYS,
} from "./hcp.js";

const SOURCES = new Map<string, SourceDefinition>([
  [HCP_IPC_2017_SOURCE.source_id, HCP_IPC_2017_SOURCE],
  [HCP_IPP_2018_SOURCE.source_id, HCP_IPP_2018_SOURCE],
]);

export function getSourceDefinition(sourceId: string): SourceDefinition {
  const source = SOURCES.get(sourceId);
  if (!source) {
    throw new Error(`unknown_source:${sourceId}`);
  }
  return source;
}
