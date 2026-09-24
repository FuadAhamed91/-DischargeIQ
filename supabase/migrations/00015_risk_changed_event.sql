-- 00015: a nurse's change of a patient's risk colour, on the timeline
--
-- The colour (care_episodes.current_risk_level) is raised automatically and
-- never lowered by the system. A nurse lowers it after following up, with a
-- note (POST /api/v1/episodes/[id]/risk); the change is recorded on the
-- episode timeline as 'risk_changed', and in audit_logs. Until this migration
-- is applied the route still changes the colour and writes the audit log —
-- only the timeline entry is missing.

ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'risk_changed';
