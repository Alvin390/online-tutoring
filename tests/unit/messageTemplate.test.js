import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  analyseTemplate,
  appendAttachments,
  formatBytes,
  previewWithExamples,
  VARIABLES,
} from '@utils/messageTemplate';

const recipient = {
  studentName: 'Amina Wanjiru',
  class: 'Grade 8',
  feeBalance: 1500,
  nextDueDate: Date.parse('2026-03-15T00:00:00Z'),
  sessionName: 'Morning Session',
};

describe('renderTemplate', () => {
  it('resolves every documented variable', () => {
    expect(renderTemplate('{{studentName}}', recipient)).toBe('Amina Wanjiru');
    expect(renderTemplate('{{class}}', recipient)).toBe('Grade 8');
    expect(renderTemplate('{{balance}}', recipient)).toBe('KES 1,500');
    expect(renderTemplate('{{dueDate}}', recipient)).toBe('15 Mar 2026');
    expect(renderTemplate('{{sessionName}}', recipient)).toBe('Morning Session');
  });

  it('renders the highest-value message a tutor sends', () => {
    const template =
      'Dear parent, the balance for {{studentName}} is {{balance}}, due {{dueDate}}.';
    expect(renderTemplate(template, recipient)).toBe(
      'Dear parent, the balance for Amina Wanjiru is KES 1,500, due 15 Mar 2026.'
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ studentName }}', recipient)).toBe('Amina Wanjiru');
  });

  it('replaces every occurrence', () => {
    expect(renderTemplate('{{class}} and {{class}}', recipient)).toBe('Grade 8 and Grade 8');
  });

  it('LEAVES an unknown variable verbatim rather than writing "undefined"', () => {
    // "Dear undefined" is worse than "Dear {{parentName}}", because the second
    // is obviously a mistake the teacher can see in the preview.
    expect(renderTemplate('Dear {{parentName}}', recipient)).toBe('Dear {{parentName}}');
    expect(renderTemplate('Dear {{parentName}}', recipient)).not.toContain('undefined');
  });

  it('falls back readably for a known variable with no value', () => {
    expect(renderTemplate('{{studentName}}', {})).toBe('the student');
    expect(renderTemplate('{{balance}}', {})).toBe('KES 0');
    expect(renderTemplate('{{dueDate}}', {})).toBe('');
  });

  it('never emits "undefined" or "null" for any variable on an empty recipient', () => {
    for (const variable of VARIABLES) {
      const output = renderTemplate(`{{${variable.token}}}`, {});
      expect(output, variable.token).not.toContain('undefined');
      expect(output, variable.token).not.toContain('null');
      expect(output, variable.token).not.toContain('NaN');
    }
  });

  it('handles a Firestore Timestamp for the due date', () => {
    const ts = { toMillis: () => Date.parse('2026-03-15T00:00:00Z') };
    expect(renderTemplate('{{dueDate}}', { nextDueDate: ts })).toBe('15 Mar 2026');
  });

  it('handles a malformed date without throwing', () => {
    expect(renderTemplate('{{dueDate}}', { nextDueDate: 'nonsense' })).toBe('');
  });

  it('returns an empty string for a non-string template', () => {
    expect(renderTemplate(null, recipient)).toBe('');
    expect(renderTemplate(undefined, recipient)).toBe('');
  });

  it('leaves text with no variables untouched', () => {
    expect(renderTemplate('Class is cancelled today.', recipient))
      .toBe('Class is cancelled today.');
  });
});

describe('analyseTemplate', () => {
  it('separates known from unknown tokens', () => {
    const result = analyseTemplate('{{studentName}} owes {{balance}} — ask {{parentName}}');
    expect(result.used.sort()).toEqual(['balance', 'studentName']);
    expect(result.unknown).toEqual(['parentName']);
  });

  it('deduplicates', () => {
    expect(analyseTemplate('{{class}} {{class}}').used).toEqual(['class']);
  });

  it('handles a template with no tokens', () => {
    expect(analyseTemplate('plain text')).toEqual({ used: [], unknown: [] });
  });
});

describe('appendAttachments', () => {
  it('appends the link, since a file can never be pre-attached to wa.me', () => {
    const result = appendAttachments('Here is the worksheet.', [
      { filename: 'week3.pdf', downloadUrl: 'https://example.com/a.pdf', sizeBytes: 250000 },
    ]);
    expect(result).toContain('Here is the worksheet.');
    expect(result).toContain('week3.pdf (244 KB)');
    expect(result).toContain('https://example.com/a.pdf');
  });

  it('lists several attachments', () => {
    const result = appendAttachments('Docs', [
      { filename: 'a.pdf', downloadUrl: 'https://example.com/a', sizeBytes: 1000 },
      { filename: 'b.pdf', downloadUrl: 'https://example.com/b', sizeBytes: 2000 },
    ]);
    expect(result).toContain('a.pdf');
    expect(result).toContain('b.pdf');
  });

  it('returns the message unchanged when there is nothing to attach', () => {
    expect(appendAttachments('Hello', [])).toBe('Hello');
    expect(appendAttachments('Hello')).toBe('Hello');
  });

  it('omits the size when unknown', () => {
    const result = appendAttachments('Doc', [
      { filename: 'a.pdf', downloadUrl: 'https://example.com/a' },
    ]);
    expect(result).toContain('a.pdf:');
    expect(result).not.toContain('(');
  });
});

describe('formatBytes', () => {
  it('formats across the range', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
  });
});

describe('previewWithExamples', () => {
  it('renders sample data for the composer', () => {
    expect(previewWithExamples('{{studentName}} owes {{balance}}'))
      .toBe('Amina Wanjiru owes KES 1,500');
  });
});
