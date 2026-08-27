import {
  CanonicalObservationSchema,
  type CanonicalObservation,
  type ObservationCandidate,
} from "@data-hub/contracts";

import { canonicalJson, sha256Hex } from "./canonical-json.js";

export interface ResolveRevisionsInput {
  candidates: ObservationCandidate[];
  previous: CanonicalObservation[];
  qualityStatus?: "accepted" | "accepted_with_warning";
  warningCodes?: string[];
}

function semanticEvidence(
  value: ObservationCandidate | CanonicalObservation,
): string {
  return canonicalJson({
    natural_key: value.natural_key,
    series_key: value.series_key,
    source_series_label: value.source_series_label,
    period_start: value.period_start,
    period_end: value.period_end,
    frequency: value.frequency,
    value: value.value,
    unit: value.unit,
    currency: value.currency,
    scaling_factor: value.scaling_factor,
    geography_type: value.geography_type,
    location_key: value.location_key,
    source_id: value.source_id,
  });
}

function currentPrevious(
  previous: CanonicalObservation[],
): Map<string, CanonicalObservation> {
  const grouped = new Map<string, CanonicalObservation[]>();
  for (const observation of previous) {
    const group = grouped.get(observation.natural_key) ?? [];
    group.push(observation);
    grouped.set(observation.natural_key, group);
  }
  const result = new Map<string, CanonicalObservation>();
  for (const [naturalKey, group] of grouped) {
    const maximumRevision = Math.max(...group.map((row) => row.revision_number));
    const current = group.filter((row) => row.revision_number === maximumRevision);
    if (current.length !== 1) {
      throw new Error(`multiple_current_observations:${naturalKey}`);
    }
    const currentObservation = current[0];
    if (!currentObservation) {
      throw new Error(`missing_current_observation:${naturalKey}`);
    }
    result.set(naturalKey, currentObservation);
  }
  return result;
}

function createObservation(
  candidate: ObservationCandidate,
  revisionNumber: number,
  supersedesObservationId: string | null,
  qualityStatus: "accepted" | "accepted_with_warning",
  warningCodes: string[],
): CanonicalObservation {
  const { scalar_reproducible: ignored, ...candidateFields } = candidate;
  void ignored;
  const evidence = {
    ...candidateFields,
    quality_status: qualityStatus,
    warning_codes: warningCodes,
    revision_number: revisionNumber,
    supersedes_observation_id: supersedesObservationId,
  };
  return CanonicalObservationSchema.parse({
    ...evidence,
    observation_id: `sha256:${sha256Hex(canonicalJson(evidence))}`,
  });
}

export function resolveRevisions(
  input: ResolveRevisionsInput,
): CanonicalObservation[] {
  const previous = currentPrevious(input.previous);
  const candidates = new Map<string, ObservationCandidate>();
  for (const candidate of input.candidates) {
    const existing = candidates.get(candidate.natural_key);
    if (existing && semanticEvidence(existing) !== semanticEvidence(candidate)) {
      throw new Error(`conflicting_candidate:${candidate.natural_key}`);
    }
    if (!existing) candidates.set(candidate.natural_key, candidate);
  }

  const result: CanonicalObservation[] = [];
  for (const candidate of candidates.values()) {
    const current = previous.get(candidate.natural_key);
    if (current && semanticEvidence(current) === semanticEvidence(candidate)) {
      result.push(current);
      continue;
    }
    result.push(
      createObservation(
        candidate,
        current ? current.revision_number + 1 : 1,
        current?.observation_id ?? null,
        input.qualityStatus ?? "accepted",
        input.warningCodes ?? [],
      ),
    );
  }
  return result.sort((left, right) =>
    left.natural_key.localeCompare(right.natural_key) ||
    left.revision_number - right.revision_number ||
    left.artifact_sha256.localeCompare(right.artifact_sha256) ||
    left.source_row - right.source_row ||
    left.source_column - right.source_column,
  );
}
