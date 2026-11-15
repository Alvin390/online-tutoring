import { describe, it, expect } from 'vitest';
import * as client from '@shared/utils/duplicates';
import * as server from '../../../api/_lib/duplicates.js';

/**
 * 008Fixes / 06b — the duplicate rule catches every same-session repeat
 * (owner, 2026-11-15: "absolutely no duplicates in sessions").
 *
 * The fixtures copy the SHAPE of the 11 live pairs in the owner's 15 Nov list
 * (names short vs full, a decorative font, one payment on two students…).
 * Names, codes and numbers are invented: this repository is public.
 */

let seq = 0;
const phone = () => { seq += 1; return `+2547${String(20000000 + seq * 7919).padStart(8, '0')}`; };
const rec = (studentName, cls, receiptMessage = '', over = {}) => ({ studentName, class: cls, receiptMessage, parentPhone: phone(), ...over });
const paid = (code, kes = '1,100.00') => `${code} Confirmed. Ksh${kes} paid to FOCUS ONLINE SCHOOL.`;

const PAIRS = [
  // kind, a, b, expected reasons (server and client)
  ['decorative font + same code + 1 digit off', (() => {
    const a = rec('Amina Otieno', 'Grade 10', paid('UK1AA01ZWF', '2,750.00'), { parentPhone: '+254711222266' });
    const b = rec('𝑨𝒎𝒊𝒏𝒂 𝒐𝒕𝒊𝒆𝒏𝒐', 'Grade 10', paid('UK1AA01ZWF', '2,750.00'), { parentPhone: '+254711222666' });
    return [a, b];
  })(), ['receipt', 'number']],
  ['short vs full name + same code', [rec('Zawadi', 'Form 3', `1,500: ${paid('UK2J10W8AA', '1,500.00')}`), rec('Zawadi Baraka', 'Form 3', `1500: ${paid('UK2J10W8AA', '1,500.00')}`)], ['code']],
  ['short vs full name + same code (2)', [rec('Nuru Imani', 'Grade 10', paid('UJVLG04QAA', '2,750.00')), rec('Nuru Imani Tumaini', 'Grade 10', paid('UJVLG04QAA', '2,750.00'))], ['receipt']],
  ['short vs full name + same code (3)', [rec('Jabali Shujaa', 'Grade 10', 'UK9HG17AAI Confirmed. KSH. 550 paid'), rec('Jabali Shujaa Kito', 'Grade 10', 'UK9HG17AAI Confirmed. KSH. 550 paid')], ['receipt']],
  ['short vs full name, nothing else', [rec('Malaika', 'Form 3', 'Paid 400 to the teacher'), rec('Pendo Malaika', 'Form 3', 'Confirmed 2750 sent')], ['name']],
  ['identical name and class, different payments and phones', [rec('Daudi Mtiti', 'Form 3', paid('UK95E1RJAA', '500.00')), rec('Daudi Mtiti', 'Form 3', paid('UK25E0TGAA', '550.00'))], ['name']],
  ['identical full name and class, different payments', [rec('Rehema Waridi Kito', 'Grade 10', paid('UK7281VBAA', '550.00')), rec('rehema waridi kito', 'Grade 10', paid('UK22814DAA', '500.00'))], ['name']],
  ['identical one-word name, one without a receipt', [rec('Tausi', 'Form 3', 'UK82M1V3AA'), rec('Tausi', 'Form 3', 'Week 2 550 message seen')], ['name']],
  ['different names, one payment', [rec('Asali Mbali', 'Form 3', `1000: ${paid('UK2PE037AA', '1,000.00')}`), rec('Baraka Mbali Siku', 'Form 3', `1000: ${paid('UK2PE037AA', '1,000.00')}`)], ['payment']],
  ['different names, one payment (2)', [rec('Juma Hodari Simba', 'Grade 8', paid('UK1GBBUHAA')), rec('Jumanne Tulivu Simba', 'Grade 8', paid('UK1GBBUHAA'))], ['payment']],
  ['different names AND classes, one payment', [rec('Dalili Bahati Upendo', 'Grade 8', paid('UK2I40FPAA')), rec('Faraja Kito', 'Form 3', paid('UK2I40FPAA'))], ['payment']],
];

describe('the 11 kinds of pair from the 15 Nov list are all flagged', () => {
  for (const [label, [a, b], reasons] of PAIRS) {
    it(label, () => {
      expect(server.matchReasons(a, b)).toEqual(reasons);
      expect(client.matchReasons(a, b)).toEqual(reasons);
      expect(server.matchReasons(b, a)).toEqual(reasons);
    });
  }

  it('findDuplicateGroups on a roster holding all of them finds 11 groups, one per pair', () => {
    const roster = PAIRS.flatMap(([, pair]) => pair);
    roster.push(rec('Kevin Otieno', 'Form 3', paid('UK00000AAA')), rec('Brenda Atieno', 'Grade 8', 'cash'));
    const groups = server.findDuplicateGroups(roster);
    expect(groups).toHaveLength(11);
    expect(groups.map((g) => g.students.length)).toEqual(Array(11).fill(2));
    expect(client.findDuplicateGroups(roster).length).toBe(11);
  });
});

describe('the pieces', () => {
  it('decorative fonts, full width and accents read as plain letters', () => {
    for (const lib of [server, client]) {
      expect(lib.normaliseName('𝑨𝒎𝒊𝒏𝒂 𝒐𝒕𝒊𝒆𝒏𝒐')).toBe('aminaotieno');
      expect(lib.normaliseName('𝓐𝓶𝓲𝓷𝓪')).toBe('amina');
      expect(lib.normaliseName('ＡＭＩＮＡ')).toBe('amina');
      expect(lib.normaliseName("Zoë O'Brien")).toBe('zoeobrien');
      expect(lib.nameWords('𝑨𝒎𝒊𝒏𝒂  Otieno-Wanjiku O')).toEqual(['amina', 'otieno', 'wanjiku']);
    }
  });

  it('names match when identical or when one name\'s words are all in the other', () => {
    expect(server.namesMatch('Zawadi', 'Zawadi Baraka')).toBe(true);
    expect(server.namesMatch('Baraka Zawadi', 'zawadi baraka')).toBe(true);
    expect(server.namesMatch('AnaJoy', 'Ana Joy')).toBe(true);
    expect(server.namesMatch('Amina Wanjiku', 'Amina Otieno')).toBe(false);
    expect(server.namesMatch('', 'Amina')).toBe(false);
    expect(server.namesMatch('A', 'A Kamau')).toBe(false); // one-letter words are ignored
  });

  it('M-Pesa codes: any letter case, and O and 0 alike', () => {
    expect(server.mpesaCode('vk30v18cie confirmed')).toBe('VK30V18CIE');
    const a = rec('Amani Kito', 'Form 3', 'UK23G0R2FH Confirmed');
    const b = rec('Hodari Simba', 'Grade 8', 'uk23gor2fh confirmed');
    expect(server.matchReasons(a, b)).toEqual(['payment']);
  });
});

describe('still NOT duplicates', () => {
  it('different names with different payments (or none)', () => {
    expect(server.matchReasons(rec('Amina Wanjiku', 'Form 3', paid('UKAAAAAAA1')), rec('Amina Otieno', 'Form 3', paid('UKAAAAAAA2')))).toEqual([]);
    expect(server.matchReasons(rec('Brian Kamau', 'Form 3'), rec('Kevin Otieno', 'Form 3'))).toEqual([]);
  });

  it('the same name in another class, with different payments', () => {
    expect(server.matchReasons(rec('Brian Kamau', 'Form 3', paid('UKAAAAAAA3')), rec('Brian Kamau', 'Grade 8', paid('UKAAAAAAA4')))).toEqual([]);
  });

  it('identical text with no M-Pesa code never pairs different students', () => {
    expect(server.matchReasons(rec('Brian Kamau', 'Form 3', 'cash paid to teacher'), rec('Kevin Otieno', 'Form 3', 'cash paid to teacher'))).toEqual([]);
  });

  it('staff are never paired; a pair the teacher kept is never flagged again; the same phone is one record', () => {
    const a = rec('Zawadi', 'Form 3', paid('UKAAAAAAA5'));
    const b = rec('Zawadi Baraka', 'Form 3', paid('UKAAAAAAA5'));
    expect(server.matchReasons({ ...a, staff: true }, b)).toEqual([]);
    expect(server.matchReasons({ ...a, duplicateKeep: [b.parentPhone] }, b)).toEqual([]);
    expect(server.matchReasons(b, { ...a, duplicateKeep: [b.parentPhone] })).toEqual([]);
    expect(server.matchReasons(a, { ...b, parentPhone: a.parentPhone })).toEqual([]);
    expect(server.findDuplicateGroups([{ ...a, staff: true }, b])).toEqual([]);
  });
});

describe('groups list the pairs the teacher needs', () => {
  it('ten identical names in one class: one group of ten, nine pairs', () => {
    const ten = Array.from({ length: 10 }, (_, k) => rec('Amina Wanjiku', 'Form 3', `cash ${k}`));
    const groups = server.findDuplicateGroups(ten);
    expect(groups).toHaveLength(1);
    expect(groups[0].students).toHaveLength(10);
    expect(groups[0].pairs).toHaveLength(9);
  });

  it('three on one payment: every pair listed', () => {
    const three = [rec('Amani Kito', 'Form 3', paid('UKPAY00001')), rec('Hodari Simba', 'Form 3', paid('UKPAY00001')), rec('Zuri Mbali', 'Grade 8', paid('UKPAY00001'))];
    expect(server.findDuplicateGroups(three)[0].pairs).toHaveLength(3);
  });

  it("retiredMessage: the student page's own module answers as the server does", async () => {
    const { retiredMessage } = await import('@shared/utils/retiredMessage');
    for (const [reason, suffix] of [['merged', '678'], ['merged', null], ['duplicate', null]]) {
      expect(retiredMessage(reason, suffix)).toBe(server.retiredMessage(reason, suffix));
      expect(client.retiredMessage(reason, suffix)).toBe(server.retiredMessage(reason, suffix));
    }
  });
});

describe('what the teacher reads', () => {
  it('labels for the new reasons, and the held-registration line for a shared payment', async () => {
    const { reasonLabels, matchedLine } = await import('@features/dashboard/duplicates/duplicatePairs');
    expect(reasonLabels(['name', 'payment'])).toEqual(['Same name and class', 'Same M-Pesa payment, different student']);
    const original = rec('Amani Kito', 'Form 3', paid('UKLINE0001'), { parentPhone: '+254711000678' });
    const held = rec('Hodari Simba', 'Grade 8', paid('UKLINE0001'));
    expect(matchedLine(held, original)).toBe('Same M-Pesa payment as Amani Kito (number ending …678)');
    const same = rec('Amani Kito', 'Form 3', 'cash');
    expect(matchedLine(same, original)).toMatch(/^Same name and class as Amani Kito/);
  });
});

describe('fast', () => {
  it('5,000 students in under 150 ms', () => {
    // A big school: 60 first names, 60 surnames, some three-part names, a few
    // one-word names, mostly unique M-Pesa codes with some reused.
    const first = Array.from({ length: 60 }, (_, k) => `First${String.fromCharCode(65 + (k % 26))}${String.fromCharCode(97 + Math.floor(k / 26))}`);
    const last = Array.from({ length: 60 }, (_, k) => `Sur${String.fromCharCode(97 + (k % 26))}${String.fromCharCode(97 + Math.floor(k / 26))}x`);
    const classes = ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'];
    let x = 7;
    const rnd = (k) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return (x >>> 8) % k; };
    const nameOf = () => {
      const r = rnd(20);
      if (r === 0) return first[rnd(60)];
      return `${first[rnd(60)]} ${last[rnd(60)]}${r < 6 ? ` ${last[rnd(60)]}` : ''}`;
    };
    const roster = Array.from({ length: 5000 }, (_, i) => ({
      parentPhone: `+2547${String(10000000 + i * 13).padStart(8, '0')}`,
      studentName: nameOf(),
      class: classes[rnd(4)],
      receiptMessage: rnd(5) ? paid(`UK${String(100000 + rnd(4800)).padStart(6, '0')}AB`) : 'cash',
    }));
    server.findDuplicateGroups(roster); // warm
    const t0 = performance.now();
    const groups = server.findDuplicateGroups(roster);
    expect(performance.now() - t0).toBeLessThan(150);
    expect(groups.length).toBeGreaterThan(0);
  });
});
