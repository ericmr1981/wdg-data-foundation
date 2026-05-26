-- Migration: add condition2 (AND match) fields to approval_proposal
-- Enables LLM and users to propose rules requiring TWO conditions to match.

ALTER TABLE ops.approval_proposal
  ADD COLUMN IF NOT EXISTS llm_match_field2   TEXT,
  ADD COLUMN IF NOT EXISTS llm_match_value2  TEXT,
  ADD COLUMN IF NOT EXISTS final_match_field2 TEXT,
  ADD COLUMN IF NOT EXISTS final_match_value2 TEXT;