// agent/src/skills/registry.test.ts
import { test, before } from 'node:test'
import { strict as assert } from 'node:assert'
import { initRegistry, listSkillDescriptions, getSkill, getSkillFullText, listSkillNames } from './registry.ts'

before(() => {
  initRegistry()
})

test('registry loaded expected skills', () => {
  const names = listSkillNames()
  assert.ok(names.length >= 5, `expected at least 5 skills, got ${names.length}`)
  assert.ok(names.includes('weekly-bank-review'))
  assert.ok(names.includes('wdg-data-platform'))
  assert.ok(names.includes('bank-classification'))
  assert.ok(names.includes('financial-rates'))
  assert.ok(names.includes('forbidden-shortcuts'))
})

test('listSkillDescriptions mentions all skills', () => {
  const desc = listSkillDescriptions()
  for (const name of ['weekly-bank-review', 'wdg-data-platform']) {
    assert.match(desc, new RegExp(name))
  }
})

test('getSkill returns skill for valid name', () => {
  const s = getSkill('weekly-bank-review')
  assert.ok(s)
  assert.equal(s!.frontmatter.name, 'weekly-bank-review')
  assert.match(s!.body, /get_pipeline_kpi/)
})

test('getSkill returns null for missing', () => {
  assert.equal(getSkill('non-existent'), null)
})

test('getSkillFullText formats correctly', () => {
  const text = getSkillFullText('weekly-bank-review')
  assert.ok(text)
  assert.match(text!, /^# Skill: weekly-bank-review/)
})
