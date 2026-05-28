import type { ProjectFile } from './types';

export const sampleProject: ProjectFile = {
  version: 1,
  tables: [
    {
      id: 'speaker',
      name: 'Speaker',
      position: { x: 120, y: 120 },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        { id: 'name', name: 'name', type: 'string', required: true },
      ],
      rows: [
        { _rowId: 'row_speaker_1', values: { id: 1001, name: '人类' } },
        { _rowId: 'row_speaker_2', values: { id: 1002, name: '旁白' } },
      ],
    },
    {
      id: 'dialogue',
      name: 'Dialogue',
      position: { x: 460, y: 120 },
      columns: [
        { id: 'id', name: 'id', type: 'int', primary: true, required: true },
        { id: 'desc', name: 'desc', type: 'string', required: true },
        {
          id: 'speaker_id',
          name: 'speaker_id',
          type: 'ref',
          required: true,
          ref: { tableId: 'speaker', columnId: 'id' },
        },
      ],
      rows: [
        {
          _rowId: 'row_dialogue_1',
          values: {
            id: 1,
            desc: '上帝为什么要创造我',
            speaker_id: 1001,
          },
        },
        {
          _rowId: 'row_dialogue_2',
          values: {
            id: 2,
            desc: '今天心情不错',
            speaker_id: 1001,
          },
        },
      ],
    },
  ],
};

export function createSampleProject(): ProjectFile {
  return structuredClone(sampleProject);
}
