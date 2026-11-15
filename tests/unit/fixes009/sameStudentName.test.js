import { describe, it, expect } from 'vitest';
import * as server from '../../../api/_lib/duplicates.js';
import * as client from '@utils/duplicates';

/**
 * 009Fixes / 02 — finding one's own record by name: the SAME name (fonts,
 * case, accents and word order ignored), at least two words; stricter than
 * the duplicate rule's namesMatch, which also matches a name inside another.
 */
describe('sameStudentName', () => {
  it('same name, any order, any font; not a part of it; not one word', () => {
    for (const lib of [server, client]) {
      expect(lib.sameStudentName('Wanjiru Akinyi Moraa', 'moraa WANJIRU akinyi')).toBe(true);
      expect(lib.sameStudentName('𝐖𝐚𝐧𝐣𝐢𝐫𝐮 Akinyi', 'Wanjiru Akinyi')).toBe(true);
      expect(lib.sameStudentName('Wanjirũ Akinyi', 'Wanjiru Akinyi')).toBe(true);
      expect(lib.sameStudentName('Wanjiru Akinyi', 'Wanjiru Akinyi Moraa')).toBe(false); // namesMatch says true
      expect(lib.namesMatch('Wanjiru Akinyi', 'Wanjiru Akinyi Moraa')).toBe(true);
      expect(lib.sameStudentName('Wanjiru', 'Wanjiru')).toBe(false);
      expect(lib.sameStudentName('Brian Otieno', 'Brian Odhiambo')).toBe(false);
    }
  });
});
