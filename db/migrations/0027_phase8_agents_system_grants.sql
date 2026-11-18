-- The system role runs agents and executes proposals, so it needs to read and write the agent tables
-- (the policies already admit it; this is the table privilege that goes with them).
GRANT SELECT, INSERT, UPDATE ON agent_configs, agent_runs, agent_proposals TO system;
