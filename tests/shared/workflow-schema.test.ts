import { describe, it, expect } from 'vitest';
import { parsePlanYaml, validatePlan, type WorkflowPlan } from '../../src/shared/workflow-schema.js';

describe('parsePlanYaml', () => {
  it('parses valid YAML into a WorkflowPlan', () => {
    const yaml = `
name: "Test workflow"
config:
  onComplete: pr
  branch: feat/test
tasks:
  - id: task1
    description: "Do something"
    produce:
      type: implement
      role: implementer
`;
    const plan = parsePlanYaml(yaml);
    expect(plan.name).toBe('Test workflow');
    expect(plan.config.onComplete).toBe('pr');
    expect(plan.config.branch).toBe('feat/test');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].id).toBe('task1');
    expect(plan.tasks[0].produce.type).toBe('implement');
    expect(plan.tasks[0].produce.role).toBe('implementer');
  });

  it('parses plan with review and dependencies', () => {
    const yaml = `
name: "Full plan"
config:
  onComplete: notify
  baseBranch: develop
tasks:
  - id: spec
    description: "Write spec"
    produce:
      type: plan
      role: orchestrator
      prompt: "Be thorough"
    review:
      role: reviewer
      prompt: "Check completeness"
  - id: impl
    description: "Implement"
    produce:
      type: implement
      role: implementer
    files:
      - src/main.ts
    dependsOn:
      - spec
`;
    const plan = parsePlanYaml(yaml);
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].review?.role).toBe('reviewer');
    expect(plan.tasks[0].produce.prompt).toBe('Be thorough');
    expect(plan.tasks[1].dependsOn).toEqual(['spec']);
    expect(plan.tasks[1].files).toEqual(['src/main.ts']);
  });

  it('throws on invalid YAML syntax', () => {
    expect(() => parsePlanYaml(': {{{not yaml')).toThrow();
  });

  it('throws on non-object YAML (string)', () => {
    expect(() => parsePlanYaml('just a string')).toThrow('expected a YAML object');
  });

  it('throws on non-object YAML (array)', () => {
    expect(() => parsePlanYaml('- item1\n- item2')).toThrow('expected a YAML object');
  });
});

describe('validatePlan', () => {
  const validPlan: WorkflowPlan = {
    name: 'Test',
    config: { onComplete: 'pr' },
    tasks: [{
      id: 'task1',
      description: 'Do something',
      produce: { type: 'implement', role: 'implementer' },
    }],
  };

  it('returns empty array for valid plan', () => {
    expect(validatePlan(validPlan)).toEqual([]);
  });

  it('returns empty array for plan with valid review', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [{
        id: 'task1',
        description: 'Do something',
        produce: { type: 'plan', role: 'orchestrator' },
        review: { role: 'reviewer' },
      }],
    };
    expect(validatePlan(plan)).toEqual([]);
  });

  it('returns empty array for plan with valid dependencies', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [
        { id: 'a', description: 'A', produce: { type: 'plan', role: 'orchestrator' } },
        { id: 'b', description: 'B', produce: { type: 'implement', role: 'implementer' }, dependsOn: ['a'] },
      ],
    };
    expect(validatePlan(plan)).toEqual([]);
  });

  it('detects missing name', () => {
    const plan = { ...validPlan, name: '' };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.field === 'name')).toBe(true);
  });

  it('detects invalid onComplete', () => {
    const plan = { ...validPlan, config: { onComplete: 'invalid' as any } };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.field === 'config.onComplete')).toBe(true);
  });

  it('detects empty tasks', () => {
    const plan = { ...validPlan, tasks: [] };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.field === 'tasks')).toBe(true);
  });

  it('detects duplicate task IDs', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [
        { id: 'dup', description: 'A', produce: { type: 'plan', role: 'orchestrator' } },
        { id: 'dup', description: 'B', produce: { type: 'plan', role: 'orchestrator' } },
      ],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.message.includes('duplicate'))).toBe(true);
  });

  it('detects dangling dependsOn references', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [{
        id: 'task1',
        description: 'Do something',
        produce: { type: 'implement', role: 'implementer' },
        dependsOn: ['nonexistent'],
      }],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.message.includes('unknown task'))).toBe(true);
  });

  it('detects cyclic dependencies', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [
        { id: 'a', description: 'A', produce: { type: 'plan', role: 'orchestrator' }, dependsOn: ['b'] },
        { id: 'b', description: 'B', produce: { type: 'plan', role: 'orchestrator' }, dependsOn: ['a'] },
      ],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.message.includes('cyclic'))).toBe(true);
  });

  it('detects 3-node cycle', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [
        { id: 'a', description: 'A', produce: { type: 'plan', role: 'orchestrator' }, dependsOn: ['c'] },
        { id: 'b', description: 'B', produce: { type: 'plan', role: 'orchestrator' }, dependsOn: ['a'] },
        { id: 'c', description: 'C', produce: { type: 'plan', role: 'orchestrator' }, dependsOn: ['b'] },
      ],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.message.includes('cyclic'))).toBe(true);
  });

  it('detects invalid produce role', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [{
        id: 'task1',
        description: 'Do something',
        produce: { type: 'implement', role: 'invalid_role' as any },
      }],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.field.includes('produce.role'))).toBe(true);
  });

  it('detects invalid review role', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [{
        id: 'task1',
        description: 'Do something',
        produce: { type: 'implement', role: 'implementer' },
        review: { role: 'bad_role' as any },
      }],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.field.includes('review.role'))).toBe(true);
  });

  it('detects invalid produce type', () => {
    const plan: WorkflowPlan = {
      ...validPlan,
      tasks: [{
        id: 'task1',
        description: 'Do something',
        produce: { type: 'command' as any, role: 'implementer' },
      }],
    };
    const errors = validatePlan(plan);
    expect(errors.some(e => e.field.includes('produce.type'))).toBe(true);
  });
});
