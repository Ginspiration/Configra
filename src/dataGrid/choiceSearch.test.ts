import { describe, expect, it } from 'vitest';
import { filterChoiceOptions, type ChoiceOption } from './choiceSearch';

const options: ChoiceOption[] = [
  { key: 'monster-1', label: 'MONSTER_1 · 怪物1', value: 'MONSTER_1' },
  { key: 'monster-2', label: 'MONSTER_2 · 怪物2', value: 'MONSTER_2' },
  { key: 'boss', label: 'BOSS_ALPHA · 首领', value: 99 },
];

describe('filterChoiceOptions', () => {
  it('matches labels without case sensitivity', () => {
    expect(filterChoiceOptions(options, 'monster_2')).toEqual([options[1]]);
  });

  it('matches all search tokens across the formatted label', () => {
    expect(filterChoiceOptions(options, 'monster 怪物1')).toEqual([options[0]]);
  });

  it('also matches the stored value', () => {
    expect(filterChoiceOptions(options, '99')).toEqual([options[2]]);
  });
});
