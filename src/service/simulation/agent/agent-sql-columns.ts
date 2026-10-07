/** 受限 SQL 解析与提示词共用的列契约；修订号仅用于条件。 */
export const WORLD_SIMULATION_SQL_COLUMNS_ACU: Readonly<Record<string, ReadonlySet<string>>> = {
  dimensions: new Set(['id', 'name', 'kind', 'value', 'trend', 'rationale', 'evidence_refs', 'expected_revision']),
  seeds: new Set(['id', 'title', 'status', 'level', 'catalyst', 'visibility', 'actor_ids', 'location', 'expires_at_day', 'missed_outcome', 'expose_policy', 'evidence_refs', 'retired_reason', 'expected_revision']),
  actors: new Set(['id', 'name', 'interests', 'location', 'location_ref', 'life', 'died_at_day', 'death_summary', 'resources', 'goals', 'constraints', 'information_sources', 'known_facts', 'visibility', 'current_action', 'long_term_action', 'evidence_refs', 'expected_revision']),
  rumors: new Set(['id', 'fact', 'origin_day', 'earliest_reveal_day', 'channels', 'related_actor_ids', 'status', 'revealed_at_day', 'evidence_refs', 'expected_revision']),
  chronicle: new Set(['id', 'at', 'summary', 'related_ids', 'evidence_refs', 'missed_note']),
  clock: new Set(['days', 'story_time', 'slot', 'evidence_refs', 'expected_revision']),
  player: new Set(['location', 'contact', 'evidence_refs', 'expected_revision']),
  guidance: new Set(['signals', 'excluded_facts', 'evidence_refs', 'expected_revision']),
  chronicle_archive: new Set(['archive_ref', 'day', 'summary', 'fingerprints', 'related_ids', 'source_chronicle_ids']),
  chronicle_overview: new Set(['fingerprint', 'day', 'one_line', 'archive_ref']),
};

export function worldSimulationSqlWritableColumns_ACU(table: string): readonly string[] {
  return [...(WORLD_SIMULATION_SQL_COLUMNS_ACU[table] ?? [])].filter(column => column !== 'expected_revision');
}
