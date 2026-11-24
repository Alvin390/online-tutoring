import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';

/**
 * 008Fixes / 09 — the composer: SMS (default) and WhatsApp to one person;
 * placeholder buttons with a guide; starters; emoji removed; the counter on
 * the longest parent's version (two SMS at most, naming whose); choosing
 * students (Gold); review, send chunk by chunk with the busy wait; delivery
 * per person and totals; old WhatsApp campaigns as history.
 */

const sms = vi.hoisted(() => ({
  listSmsPeople: vi.fn(), previewSms: vi.fn(), startSms: vi.fn(), sendSmsChunk: vi.fn(), cancelSms: vi.fn(),
  listSms: vi.fn(), getSms: vi.fn(), refreshSms: vi.fn(),
}));
vi.mock('@services/api/sms', () => sms);
const wa = vi.hoisted(() => ({ listCampaigns: vi.fn() }));
vi.mock('@services/api/whatsapp', () => wa);
const auth = vi.hoisted(() => ({ tierRank: 3, isSuperadmin: false }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => auth }));
const flags = vi.hoisted(() => ({ 'whatsapp.advanced': true, 'fees.enabled': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));

const PEOPLE = {
  students: [
    { session: 'evening', sessionName: 'Evening', phone: '+254711000001', studentName: 'Ann', class: 'Form 3', feeBalance: 550 },
    { session: 'evening', sessionName: 'Evening', phone: '+254711000002', studentName: 'Bartholomew Wekesa Omondi', class: 'Form 3', feeBalance: 2750 },
    { session: 'morning', sessionName: 'Morning', phone: '+254711000003', studentName: 'Chebet', class: 'Grade 8', feeBalance: 0 },
  ],
  staff: [{ session: 'evening', sessionName: 'Evening', phone: '+254711000009', studentName: 'Mwalimu Juma', class: 'Form 3' }],
};
const setup = { schoolName: 'Focus', unlocked: true, sender: 'HASHBACKSMS' };
const find = async (name) => screen.findByRole('button', { name });
const click = async (name) => { const b = await find(name); await act(async () => { fireEvent.click(b); }); };
const typeMessage = async (value) => {
  const box = await screen.findByLabelText('Message');
  await act(async () => { fireEvent.change(box, { target: { value } }); });
};

beforeEach(() => {
  for (const fn of [...Object.values(sms), ...Object.values(wa)]) fn.mockReset();
  sms.listSmsPeople.mockResolvedValue(PEOPLE);
  wa.listCampaigns.mockResolvedValue({ campaigns: [] });
  auth.tierRank = 3;
  flags['whatsapp.advanced'] = true;
});
afterEach(() => cleanup());

async function renderComposer(props = {}) {
  const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
  render(<SmsComposer setup={setup} {...props} />);
  await waitFor(() => expect(screen.getByTestId('sms-audience').textContent).toMatch(/3 people/));
}

describe('the text', () => {
  it('[Student name] style placeholders become tokens and back; other brackets stay', async () => {
    const { toTemplate, toFriendly, measure } = await import('@features/sms/smsDraft');
    expect(toTemplate('Hi [Student name], [student NAME] [School name] [date]')).toBe('Hi {{studentName}}, {{studentName}} {{schoolName}} [date]');
    expect(toFriendly('Dear {{studentName}}: {{balance}} {{unknown}}')).toBe('Dear [Student name]: [Fee balance] {{unknown}}');
    const m = measure('Hi [Student name], fees [Fee balance].', PEOPLE.students, 'Focus');
    expect(m).toMatchObject({ studentName: 'Bartholomew Wekesa Omondi', units: 1, totalUnits: 3, over: 0 });
    expect(m.sample).toBe('Hi Bartholomew Wekesa Omondi, fees KES 2,750.');
  });
});

describe('composing an SMS', () => {
  it('a guide above neat placeholder buttons; a button inserts its name; starters fill an empty box', async () => {
    await renderComposer();
    expect(screen.getByText(/Tap a button to add details that change for each parent/)).toBeTruthy();
    await click('Student name');
    expect(screen.getByLabelText('Message').value).toBe('[Student name]');
    await typeMessage('');
    await click('Fee reminder');
    expect(screen.getByLabelText('Message').value).toMatch(/^\[School name\]: Dear parent, \[Student name\]'s fee balance is \[Fee balance\]/);
  });

  it('emoji are removed as typed, with a notice', async () => {
    await renderComposer();
    await typeMessage('Well done 😀 all');
    expect(screen.getByLabelText('Message').value).toBe('Well done  all');
    expect(screen.getByRole('status').textContent).toMatch(/Removed 😀: emoji can't be sent by SMS/);
  });

  it('the counter: the longest version and whose; over two SMS blocks Review and says by how much', async () => {
    await renderComposer();
    await typeMessage('Dear parent of [Student name], class at 7.');
    expect(screen.getByTestId('sms-counter').textContent).toMatch(/· 1 SMS · longest for Bartholomew Wekesa Omondi/);
    expect((await find('Review and send')).disabled).toBe(false);
    await typeMessage(`${'a'.repeat(312)} [Student name]`);
    // 312 + a space + the 25-character name = 338: two over.
    expect(screen.getByTestId('sms-counter').textContent).toMatch(/^338 \/ 336 characters · 3 SMS · longest for Bartholomew Wekesa Omondi · Too long for 2 SMS\. Shorten it by 2 characters\.$/);
    expect((await find('Review and send')).disabled).toBe(true);
  });

  it('Silver: everyone only; choosing is offered as Gold', async () => {
    auth.tierRank = 2;
    await renderComposer();
    const options = [...screen.getByLabelText('Send to').querySelectorAll('option')];
    expect(options.filter((o) => o.disabled).map((o) => o.textContent)).toEqual(['A session (Gold)', 'A class (Gold)', 'Choose students (Gold)', 'Staff (teachers) (Gold)']);
  });

  it('Gold: choose students with search and multi-select', async () => {
    await renderComposer();
    await act(async () => { fireEvent.change(screen.getByLabelText('Send to'), { target: { value: 'individual' } }); });
    expect(screen.getByTestId('sms-audience').textContent).toMatch(/^0 people/);
    await act(async () => { fireEvent.change(screen.getByLabelText('Choose students: search'), { target: { value: 'che' } }); });
    const picker = screen.getByTestId('people-picker');
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(1);
    await act(async () => { fireEvent.click(within(picker).getByRole('checkbox')); });
    expect(screen.getByTestId('chosen-count').textContent).toBe('1 chosen');
    expect(screen.getByTestId('sms-audience').textContent).toMatch(/^1 person/);
  });
});

describe('sending', () => {
  it('review → send chunk by chunk (waiting when SMS is busy) → delivery', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 3, cost: 1.05, longest: { studentName: 'Bartholomew Wekesa Omondi', length: 40, text: 'Hi Bartholomew…' }, balance: 400, enoughCredit: true, reserve: 100 });
    sms.startSms.mockResolvedValue({ campaignId: 'c1', recipients: 3 });
    sms.sendSmsChunk
      .mockResolvedValueOnce({ sent: 0, failed: 0, retryAfter: 2, done: false })
      .mockResolvedValueOnce({ sent: 3, failed: 0, done: true });
    sms.refreshSms.mockResolvedValue({
      campaign: { id: 'c1', template: 'Hi {{studentName}}', recipientCount: 3, cost: 1.05, counts: { queued: 0, sent: 1, delivered: 2, failed: 0 }, createdAt: '2026-11-15T10:00:00Z' },
      recipients: [
        { id: 'a', studentName: 'Ann', phoneEnding: '001', status: 'delivered' },
        { id: 'b', studentName: 'Bartholomew', phoneEnding: '002', status: 'delivered' },
        { id: 'c', studentName: 'Chebet', phoneEnding: '003', status: 'sent' },
      ],
    });
    await renderComposer();
    await typeMessage('Hi [Student name]');
    await click('Review and send');
    expect(sms.previewSms).toHaveBeenCalledWith('Hi {{studentName}}', { type: 'all' });
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/3 people · 3 SMS/);
    // 009Fixes / 00: teachers don't pay, so no prices or credit figures.
    expect(dialog.textContent).not.toMatch(/KES/);
    expect(dialog.textContent).toMatch(/Sent from HASHBACKSMS/);
    await click('Send to 3');
    expect(await screen.findByText(/SMS is busy, carrying on in 2 s/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(await screen.findByText(/3 sent of 3/)).toBeTruthy();
    expect(sms.sendSmsChunk).toHaveBeenCalledTimes(2);
    await click('See delivery');
    expect((await screen.findByTestId('sms-totals')).textContent).toBe('3 sent · 2 delivered · 0 failed · 1 waiting');
    expect(screen.getAllByTestId('sms-person')).toHaveLength(3);
    await click('Delivered');
    expect(screen.getAllByTestId('sms-person')).toHaveLength(2);
    vi.useRealTimers();
  });

  it('out of credit mid-way: sending stops with the server\'s words', async () => {
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 3, cost: 1.05, longest: null, balance: 101, enoughCredit: true, reserve: 100 });
    sms.startSms.mockResolvedValue({ campaignId: 'c2', recipients: 3 });
    sms.sendSmsChunk.mockRejectedValue(Object.assign(new Error('SMS credit is low. Messages are paused so check-in codes keep working.'), { code: 'low_credit', status: 402 }));
    await renderComposer();
    await typeMessage('Hi');
    await click('Review and send');
    await click('Send to 3');
    expect((await screen.findByRole('alert')).textContent).toMatch(/check-in codes keep working/);
  });

  it('start refused (e.g. too long): the reason, then back to the message', async () => {
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 3, cost: 1.05, longest: null, balance: 400, enoughCredit: true, reserve: 100 });
    sms.startSms.mockRejectedValue(Object.assign(new Error("Too long for 2 SMS in Bartholomew's message."), { code: 'too_long', status: 400 }));
    await renderComposer();
    await typeMessage('Hi');
    await click('Review and send');
    await click('Send to 3');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too long for 2 SMS/);
    expect(screen.queryByRole('button', { name: 'See delivery' })).toBeNull();
    await click('Back to the message');
    expect((await find('Review and send')).disabled).toBe(false);
    expect(screen.getByLabelText('Message').value).toBe('Hi');
  });

  it('not enough credit: the review says so and offers no Send', async () => {
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 3, cost: 1.05, longest: null, balance: 100.5, enoughCredit: false, reserve: 100 });
    await renderComposer();
    await typeMessage('Hi');
    await click('Review and send');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/SMS credit is low right now\. Sending is paused so check-in codes keep working\. The owner has been told\./);
    expect(dialog.textContent).not.toMatch(/KES|100\.50/);
    expect(within(dialog).queryByRole('button', { name: /^Send to/ })).toBeNull();
    expect(sms.startSms).not.toHaveBeenCalled();
  });

  it('Stop pressed while the send is starting cancels it once it exists', async () => {
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 3, cost: 1.05, longest: null, balance: 400, enoughCredit: true, reserve: 100 });
    let resolveStart;
    sms.startSms.mockReturnValue(new Promise((r) => { resolveStart = r; }));
    sms.cancelSms.mockResolvedValue({});
    await renderComposer();
    await typeMessage('Hi');
    await click('Review and send');
    await click('Send to 3');
    await click('Stop sending');
    await act(async () => { resolveStart({ campaignId: 'c9', recipients: 3 }); });
    await waitFor(() => expect(sms.cancelSms).toHaveBeenCalledWith('c9'));
    expect(sms.sendSmsChunk).not.toHaveBeenCalled();
  });

  it('a draft for chosen people never falls back to everyone, even when choosing is not allowed', async () => {
    auth.tierRank = 2;
    const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
    render(<SmsComposer setup={setup} preset={{ template: 'Dear parent, {{studentName}} is blocked.', filterValues: ['evening:+254711000001'] }} />);
    await waitFor(() => expect(screen.getByTestId('sms-audience').textContent).toMatch(/^1 person/));
    expect(screen.getByLabelText('Send to').value).toBe('individual');
  });

  it('a draft from Recent actions opens with its text and its people chosen', async () => {
    await (async () => {
      const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
      render(<SmsComposer setup={setup} preset={{ template: 'Dear parent, {{studentName}} is blocked.', filterValues: ['evening:+254711000001'] }} />);
    })();
    await waitFor(() => expect(screen.getByTestId('sms-audience').textContent).toMatch(/^1 person/));
    expect(screen.getByLabelText('Message').value).toBe('Dear parent, [Student name] is blocked.');
  });
});

describe('WhatsApp to one person', () => {
  it('pick one student or staff member; Open WhatsApp carries their own message', async () => {
    await renderComposer();
    await click('WhatsApp (one person)');
    await typeMessage('Hello [Student name], see you at [School name].');
    await act(async () => { fireEvent.change(screen.getByLabelText('Choose one person: search'), { target: { value: 'juma' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('radio')); });
    const link = await screen.findByRole('link', { name: /Open WhatsApp/ });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/254711000009\?text=/);
    expect(decodeURIComponent(link.getAttribute('href').split('text=')[1])).toBe('Hello Mwalimu Juma, see you at Focus.');
    expect(sms.startSms).not.toHaveBeenCalled();
  });

  it('WhatsApp keeps every letter of a name; switching back to SMS drops what SMS cannot carry', async () => {
    sms.listSmsPeople.mockResolvedValue({ ...PEOPLE, students: [{ ...PEOPLE.students[0], studentName: 'Wanjirũ Ĩria' }, ...PEOPLE.students.slice(1)] });
    await renderComposer();
    await click('WhatsApp (one person)');
    await typeMessage('Hongera [Student name] 🎉');
    await act(async () => { fireEvent.change(screen.getByLabelText('Choose one person: search'), { target: { value: 'wanj' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('radio')); });
    const link = await screen.findByRole('link', { name: /Open WhatsApp/ });
    expect(decodeURIComponent(link.getAttribute('href').split('text=')[1])).toBe('Hongera Wanjirũ Ĩria 🎉');
    await click('SMS');
    expect(screen.getByLabelText('Message').value).toBe('Hongera [Student name] ');
  });
});

describe('SMS switched off (the old WhatsApp panel is removed)', () => {
  it('only WhatsApp to one person, with a notice; nothing is sent by SMS', async () => {
    const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
    render(<SmsComposer setup={null} smsOff />);
    expect((await screen.findByTestId('sms-paused')).textContent).toMatch(/not switched on yet\. You can still message one person on WhatsApp/);
    expect(screen.queryByRole('button', { name: 'SMS', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review and send' })).toBeNull();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Choose one person: search'), { target: { value: 'ann' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('radio')); });
    await typeMessage('Hi [Student name]');
    const link = await screen.findByRole('link', { name: /Open WhatsApp/ });
    expect(decodeURIComponent(link.getAttribute('href').split('text=')[1])).toBe('Hi Ann');
  });

  // 013Fixes / 02: on a plan without SMS (Bronze) the same WhatsApp-only mode,
  // with an upgrade card instead of the "not switched on" notice.
  it('SMS not in the plan: WhatsApp to one person, with an SMS upgrade card', async () => {
    auth.tierRank = 1;
    const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
    const { MemoryRouter } = await import('react-router-dom');
    render(<MemoryRouter><SmsComposer setup={null} smsOff smsOffReason="plan" /></MemoryRouter>);
    expect(await screen.findByText(/SMS to parents/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Upgrade to Silver/ })).toBeInTheDocument();
    expect(screen.queryByTestId('sms-paused')).toBeNull();
    expect(screen.queryByRole('button', { name: 'SMS', exact: true })).toBeNull();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Choose one person: search'), { target: { value: 'ann' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('radio')); });
    await typeMessage('Hi [Student name]');
    expect(await screen.findByRole('link', { name: /Open WhatsApp/ })).toBeInTheDocument();
  });

  it('a sent message opens from what is stored when HashBack may not be asked', async () => {
    sms.listSms.mockResolvedValue({ campaigns: [{ id: 's1', template: 'Hi', createdAt: '2026-11-15T10:00:00Z', counts: { delivered: 1 } }] });
    sms.refreshSms.mockRejectedValue(Object.assign(new Error('SMS is not switched on yet.'), { code: 'sms_off', status: 403 }));
    sms.getSms.mockResolvedValue({ campaign: { id: 's1', template: 'Hi', recipientCount: 1, counts: { delivered: 1 }, createdAt: '2026-11-15T10:00:00Z' }, recipients: [{ id: 'a', studentName: 'Ann', phoneEnding: '001', status: 'delivered' }] });
    const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
    render(<SmsComposer setup={null} smsOff />);
    await click('Sent messages');
    await click('Delivery');
    expect((await screen.findAllByTestId('sms-person'))).toHaveLength(1);
    expect(sms.getSms).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('no prices for teachers (009Fixes / 00)', () => {
  it('the composer, its audience line and the delivery view show no KES', async () => {
    sms.listSms.mockResolvedValue({ campaigns: [{ id: 's1', template: 'Hi', createdAt: '2026-11-15T10:00:00Z', counts: { delivered: 1 } }] });
    sms.refreshSms.mockResolvedValue({ campaign: { id: 's1', template: 'Hi', recipientCount: 1, counts: { delivered: 1 }, createdAt: '2026-11-15T10:00:00Z' }, recipients: [{ id: 'a', studentName: 'Ann', phoneEnding: '001', status: 'delivered' }] });
    await renderComposer();
    await typeMessage('Hello [Student name]');
    expect(screen.getByTestId('sms-audience').textContent).toMatch(/^3 people · about 3 SMS/);
    expect(screen.getByTestId('sms-composer').textContent).not.toMatch(/KES/);
    await click('Sent messages');
    await click('Delivery');
    await screen.findAllByTestId('sms-person');
    expect(screen.getByTestId('sms-detail').textContent).not.toMatch(/KES/);
  });
});

describe('history', () => {
  it('SMS with totals and old WhatsApp campaigns, newest first', async () => {
    sms.listSms.mockResolvedValue({ campaigns: [{ id: 's1', template: 'Hi', createdAt: '2026-11-15T10:00:00Z', counts: { sent: 0, delivered: 5, failed: 1, queued: 0 } }] });
    wa.listCampaigns.mockResolvedValue({ campaigns: [{ id: 'w1', title: 'Fees', createdAt: '2026-11-01T10:00:00Z', recipientCount: 50, sentCount: 40 }] });
    await renderComposer();
    await click('Sent messages');
    const list = await screen.findByTestId('sms-history');
    const items = within(list).getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/SMS/);
    expect(items[0].textContent).toMatch(/6 sent · 5 delivered · 1 failed · 0 waiting/);
    expect(items[1].textContent).toMatch(/WhatsApp.*40 of 50 opened in WhatsApp \(old campaign\)/);
  });
});

// 013Fixes / 16: the school's SMS units in the composer — units only, never money.
describe('SMS units', () => {
  const units = { available: 2340, includedLeft: 2000, topup: 340, granted: 3000, includedUsed: 1000 };

  it('shows the units left (included + extra) and never a price', async () => {
    const { default: SmsComposer } = await import('@features/sms/components/SmsComposer');
    render(<SmsComposer setup={{ ...setup, units }} />);
    await waitFor(() => expect(screen.getByTestId('sms-audience').textContent).toMatch(/3 people/));
    expect(screen.getByTestId('sms-units-left').textContent).toBe('SMS units left: 2,340 (2,000 included + 340 extra)');
    expect(document.body.textContent).not.toMatch(/KES|Ksh/);
  });

  it('the review says what the message uses and what is left', async () => {
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 360, unitsLeft: 2340, enoughUnits: true, longest: null, enoughCredit: true });
    await renderComposer({ setup: { ...setup, units } });
    await typeMessage('Hi');
    await click('Review and send');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('sms-units-needed').textContent).toBe('This message uses 360 SMS units. 2,340 left.');
    expect(within(dialog).getByRole('button', { name: 'Send to 3' })).toBeTruthy();
  });

  it('not enough units: says so, and offers only Close', async () => {
    sms.previewSms.mockResolvedValue({ recipients: 3, units: 360, unitsLeft: 100, enoughUnits: false, longest: null, enoughCredit: true });
    await renderComposer({ setup: { ...setup, units: { ...units, available: 100, includedLeft: 100, topup: 0 } } });
    await typeMessage('Hi');
    await click('Review and send');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('sms-units-short').textContent).toBe('Not enough SMS units. Contact us for more.');
    expect(within(dialog).queryByRole('button', { name: /^Send to/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('the billing usage card: SMS units', () => {
  it('used of included, extra, and "used up" when nothing is left', async () => {
    const { default: UsageBars } = await import('@features/billing/usage/UsageBars');
    const usage = { activeStudents: 1, sessions: 1, logins: 1, limits: { activeStudents: 300, sessions: 5, logins: 5 }, percent: {}, windowStart: null };
    const { rerender } = render(<UsageBars usage={usage} smsUnits={{ granted: 1000, includedUsed: 400, includedLeft: 600, topup: 50, available: 650 }} />);
    expect(screen.getByTestId('usage-sms').textContent).toMatch(/400 of 1,000 used · 50 extra/);
    rerender(<UsageBars usage={usage} smsUnits={{ granted: 1000, includedUsed: 1000, includedLeft: 0, topup: 0, available: 0 }} />);
    expect(screen.getByTestId('usage-sms').textContent).toMatch(/SMS units used up\. Contact us for more\./);
  });
});

