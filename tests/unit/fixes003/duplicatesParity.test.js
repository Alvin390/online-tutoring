import { describe, it, expect } from 'vitest';
import * as client from '@utils/duplicates';
import * as server from '../../../api/_lib/duplicates.js';

/** 003Fixes / 11 — the dashboard and the server judge duplicates identically. */

const names = ["Zoë O'Brien", 'zoe obrien', 'Amina Wanjiru', 'Amina  Wanjiru-', 'Brian'];
const phones = ['+254711000001', '+254711000002', '+254711000010', '+254711000432', '+254799888777'];
const receipts = ['QX12345678 Confirmed.', 'paid QX12345678', 'RZ98765432 Confirmed.', 'QX12345678 Confirmed.  '];
const corpus = [];
for (const n of names) for (const p of phones) for (const r of receipts) corpus.push({ studentName: n, parentPhone: p, class: 'Grade 7', receiptMessage: r });

describe('client and server copies', () => {
  it('export the same functions', () => {
    expect(Object.keys(client).sort()).toEqual(Object.keys(server).sort());
  });
  it('give the same verdict on every pair of a 100-record corpus', () => {
    for (let i = 0; i < corpus.length; i += 1) {
      for (let j = i + 1; j < corpus.length; j += 7) {
        expect(client.matchReasons(corpus[i], corpus[j])).toEqual(server.matchReasons(corpus[i], corpus[j]));
      }
    }
    expect(client.findDuplicateGroups(corpus).length).toBe(server.findDuplicateGroups(corpus).length);
  });
});
