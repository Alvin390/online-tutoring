import { describe, it, expect } from 'vitest';
import * as client from '@shared/utils/smsText';
import * as server from '../../../api/_lib/smsText.js';
import * as clientTemplate from '@shared/utils/messageTemplate';
import * as serverTemplate from '../../../api/_lib/messageTemplate.js';

/**
 * 008Fixes / 07 — the SMS text rules (two SMS at most, emoji refused) and the
 * template, identical in the browser and on the server. The unit maths match
 * HashBack's own quotes recorded on 2026-11-15 (168 → 1, 169 → 2, 336 → 2,
 * 337 → 3; "é" plain; an emoji not).
 */

describe('units and length (HashBack, 2026-11-15)', () => {
  it('168 plain characters a unit', () => {
    for (const [n, units] of [[0, 0], [1, 1], [160, 1], [168, 1], [169, 2], [336, 2], [337, 3]]) {
      expect(client.smsUnits(client.smsLength('a'.repeat(n))), String(n)).toBe(units);
    }
    expect(client.SMS_MAX_CHARS).toBe(336);
    expect(client.smsCost(2, 180)).toBe(126);
  });

  it('é is plain; € and [ ] count twice', () => {
    expect(client.unsupportedChars('Café à la carte')).toEqual([]);
    expect(client.smsLength('€[]')).toBe(6);
  });
});

describe('what SMS can and cannot carry', () => {
  it('curly quotes, long dashes, "…" and odd spaces become plain', () => {
    expect(client.normalizeSmsText('Amina’s “fee” — KES 550… ok')).toBe('Amina\'s "fee" - KES 550... ok');
  });

  it('emoji and other characters are refused, named once each', () => {
    const p = client.smsProblem('Well done 😀😀 ✓');
    expect(p.code).toBe('unsupported');
    expect(p.chars).toEqual(['😀', '✓']);
    expect(p.message).toMatch(/Emoji can't be sent by SMS/);
  });

  it('too long and empty', () => {
    expect(client.smsProblem('a'.repeat(337))).toMatchObject({ code: 'too_long', over: 1 });
    expect(client.smsProblem('a'.repeat(337)).message).toBe('Too long for 2 SMS. Shorten it by 1 character.');
    expect(client.smsProblem('a'.repeat(340)).message).toMatch(/4 characters\.$/);
    expect(client.smsProblem('   ').code).toBe('empty');
    expect(client.smsProblem('a'.repeat(336))).toBeNull();
  });
});

describe('the browser and the server agree', () => {
  const samples = ['Hello', 'Amina’s fee — KES 550…', 'Well done 😀', '€[x]', 'a'.repeat(337), '', 'Ça va? ñ ü Ø'];
  it('smsText', () => {
    for (const t of samples) {
      expect(server.normalizeSmsText(t)).toBe(client.normalizeSmsText(t));
      expect(server.unsupportedChars(t)).toEqual(client.unsupportedChars(t));
      expect(server.smsLength(t)).toBe(client.smsLength(t));
      expect(server.smsProblem(t)).toEqual(client.smsProblem(t));
    }
  });

  it('the template renders the same, with the new {{schoolName}}', () => {
    const template = 'Dear parent of {{studentName}} ({{class}}, {{sessionName}}): {{balance}} due {{dueDate}}. {{schoolName}} {{unknown}}';
    const r = { studentName: 'Amina', class: 'Form 3', sessionName: 'Evening', feeBalance: 2750, nextDueDate: Date.parse('2026-12-01T00:00:00Z'), schoolName: 'Focus' };
    expect(serverTemplate.renderTemplate(template, r)).toBe(clientTemplate.renderTemplate(template, r));
    expect(serverTemplate.renderTemplate(template, r)).toMatch(/^Dear parent of Amina \(Form 3, Evening\): KES 2,750 due .*\. Focus \{\{unknown\}\}$/);
    expect(serverTemplate.VARIABLES.map((v) => v.token)).toEqual(clientTemplate.VARIABLES.map((v) => v.token));
  });
});
