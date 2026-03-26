import { describe, it, expect } from 'vitest'
import { listFrameworks, loadSkill } from '../../skill-loader.js'

describe('listFrameworks()', () => {
  it('returns a sorted array of framework names', () => {
    const fw = listFrameworks()
    expect(Array.isArray(fw)).toBe(true)
    expect(fw.length).toBeGreaterThan(0)
    expect([...fw].sort()).toEqual(fw)
  })

  it('does not include guidelines', () => {
    expect(listFrameworks()).not.toContain('guidelines')
  })
})

describe('loadSkill()', () => {
  it('throws on unknown framework', () => {
    expect(() => loadSkill('nonexistent-fw')).toThrow('not supported')
  })

  it('returns a non-empty string for a known framework', () => {
    const fw = listFrameworks()[0]
    const skill = loadSkill(fw)
    expect(typeof skill).toBe('string')
    expect(skill.length).toBeGreaterThan(0)
  })

  it('prepends guidelines content when guidelines.md exists', () => {
    const fw = listFrameworks()[0]
    const skill = loadSkill(fw)
    expect(skill).toContain('---')
  })
})
