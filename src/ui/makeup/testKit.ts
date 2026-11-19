/** 補考畫面層測試共用的假資料（全部虛構；公開 repo 不得放真實學生資料） */
import { fakeSheet } from '../../core/makeup/fixtures';
import { parseMakeupWorkbook, type MakeupParseResult, type MakeupRoom } from '../../core/makeup';
import { newMakeupSession, type MakeupSession } from './session';

export const NOW = new Date('2026-11-20T02:00:00Z');

export const rooms = (n: number, seats = 30): MakeupRoom[] =>
  Array.from({ length: n }, (_, i) => ({ id: `room-${i + 1}`, name: `教室${i + 1}`, rows: 5, depth: seats / 5, seatCount: seats, use: 'class' as const }));

export function fakeParse(seed = 1, classes = [{ oldClass: '高一溫', students: 12 }, { oldClass: '高二溫', students: 8 }, { oldClass: '初一溫', students: 6 }]): MakeupParseResult {
  return parseMakeupWorkbook([{ name: 'S', rows: fakeSheet({ seed, classes, notifyExtraRatio: 0.2 }) }]);
}

export function fakeSession(o: { rooms?: MakeupRoom[]; seed?: number; id?: string } = {}): MakeupSession {
  const s = newMakeupSession({ id: o.id ?? 'mk-test', name: '', year: 115, semester: 'first', now: NOW });
  return { ...s, parse: fakeParse(o.seed ?? 1), rooms: o.rooms ?? rooms(4), source: { fileName: '假名單.xlsx', importedAt: NOW.toISOString() } };
}
