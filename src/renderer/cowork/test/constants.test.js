import { describe, it, expect } from 'vitest';
import { ROUTES, UTILITY_ROUTES, ACCENT_VARS, THINKING_PLACEHOLDER } from '../constants';

describe('constants', () => {
  it('ROUTES contains all expected route keys', () => {
    expect(ROUTES.HOME).toBe('home');
    expect(ROUTES.TASK).toBe('task');
    expect(ROUTES.PROJECTS).toBe('projects');
    expect(ROUTES.SCHEDULED).toBe('scheduled');
    expect(ROUTES.ARTIFACTS).toBe('artifacts');
    expect(ROUTES.DISPATCH).toBe('dispatch');
    expect(ROUTES.CUSTOMIZE).toBe('customize');
    expect(ROUTES.SETTINGS).toBe('settings');
    expect(ROUTES.MEMORY).toBe('memory');
    expect(ROUTES.SKILLS).toBe('skills');
    expect(ROUTES.CONNECT).toBe('connect');
    expect(ROUTES.PUBLISH).toBe('publish');
  });

  it('ROUTES has exactly 12 keys', () => {
    expect(Object.keys(ROUTES)).toHaveLength(12);
  });

  it('UTILITY_ROUTES lists the utility views', () => {
    expect(UTILITY_ROUTES).toEqual(['memory', 'skills', 'publish']);
  });

  it('UTILITY_ROUTES values all exist in ROUTES', () => {
    for (const route of UTILITY_ROUTES) {
      expect(Object.values(ROUTES)).toContain(route);
    }
  });

  it('ACCENT_VARS has all theme variants', () => {
    expect(Object.keys(ACCENT_VARS)).toEqual(['aqua', 'ocean', 'sage', 'stone']);
    expect(ACCENT_VARS.aqua).toEqual({});
    expect(ACCENT_VARS.ocean).toHaveProperty('--primary-700');
    expect(ACCENT_VARS.sage).toHaveProperty('--primary-500');
    expect(ACCENT_VARS.stone).toHaveProperty('--primary-400');
  });

  it('non-aqua accent variants have 6 CSS custom properties each', () => {
    for (const variant of ['ocean', 'sage', 'stone']) {
      expect(Object.keys(ACCENT_VARS[variant])).toHaveLength(6);
    }
  });

  it('THINKING_PLACEHOLDER is a non-empty string', () => {
    expect(THINKING_PLACEHOLDER).toBe('Thinking...');
  });
});
