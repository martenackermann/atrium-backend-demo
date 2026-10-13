import { addDaysIso, isoDateInZone } from '@/common/time/time';
import type { TestApp } from '../support/test-app';

/** Shared helpers of the training e2e specs (slice A1). */

export const API = '/api/v1';

export const EMAILS = {
  helen: 'helen.brooks@example.com',
  priya: 'priya.raman@example.com',
  victor: 'victor.lang@example.com',
  grace: 'grace.holloway@example.com',
} as const;

/** Real login for non-persona users (password demo1234). */
export async function loginEmail(t: TestApp, email: string): Promise<string> {
  const res = await t.http().post(`${API}/auth/login`).send({ email, password: 'demo1234' });
  if (res.status !== 200) throw new Error(`Login ${email} failed: ${res.status}`);
  return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
}

export function today(): string {
  return isoDateInZone(new Date(), 'Europe/Berlin');
}

export function d(offset: number): string {
  return addDaysIso(today(), offset);
}

/** Attendee rows of a seeded request (TRN number), in creation order. */
export async function attendeesOf(t: TestApp, number: number) {
  const request = await t.prisma.trainingRequest.findUniqueOrThrow({ where: { number } });
  const attendees = await t.prisma.trainingAttendee.findMany({
    where: { requestId: request.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: true },
  });
  return { request, attendees };
}

export async function attendeeId(t: TestApp, number: number, index = 0): Promise<string> {
  return (await attendeesOf(t, number)).attendees[index].id;
}

export function money(amountCents: number) {
  return { amountCents, currency: 'EUR' as const };
}

/** Minimal valid create body; override fields per test. */
export function requestBody(attendees: { userId: string }[], overrides: Record<string, unknown> = {}) {
  return {
    topic: 'Incident Communication Basics',
    provider: 'Northgate Learning',
    format: 'online',
    startsOn: d(20),
    endsOn: d(21),
    cost: money(50000),
    certificateExpected: false,
    reimbursementAgreement: false,
    attendees,
    ...overrides,
  };
}

/** A tiny PDF for upload tests. */
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);
