import { describe, expect, it } from 'vitest';
import { decryptPin, encryptPin } from './pin-cipher';
import { csvCell, toCsv } from './travel-format';
import {
  buildRoute,
  evaluateApprovalReasons,
  isAdultOn,
  isHighPriority,
  specialEquipmentReasonRequired,
} from './travel-rules';

const noEquipment = {
  estate: false,
  automaticPreferred: false,
  automaticRequired: false,
  diesel: false,
  foreignTravel: false,
};

describe('evaluateApprovalReasons (SPEC §6.3)', () => {
  it('standard car without extras needs no approval', () => {
    expect(
      evaluateApprovalReasons({
        kind: 'car',
        car: { classIsDefault: true, equipment: noEquipment, handoverMode: 'branch', dropOffMode: 'branch' },
      }),
    ).toEqual([]);
  });

  it('collects every car reason in table order', () => {
    expect(
      evaluateApprovalReasons({
        kind: 'car',
        car: {
          classIsDefault: false,
          equipment: {
            estate: true,
            automaticPreferred: true,
            automaticRequired: false,
            diesel: true,
            foreignTravel: true,
          },
          handoverMode: 'delivery',
          dropOffMode: 'collection',
        },
      }),
    ).toEqual([
      'vehicle_class_upgrade',
      'car_estate',
      'car_automatic_preferred',
      'car_diesel',
      'car_foreign_travel',
      'car_delivery',
      'car_collection',
    ]);
  });

  it('automatic required wins over preferred (S-V1 reasons)', () => {
    expect(
      evaluateApprovalReasons({
        kind: 'car',
        car: {
          classIsDefault: true,
          equipment: { ...noEquipment, automaticPreferred: true, automaticRequired: true, foreignTravel: true },
          handoverMode: 'branch',
          dropOffMode: 'branch',
        },
      }),
    ).toEqual(['car_automatic_required', 'car_foreign_travel']);
  });

  it('ignores unknown values of a partial preview body', () => {
    expect(evaluateApprovalReasons({ kind: 'car', car: { classIsDefault: null, equipment: null } })).toEqual([]);
    expect(evaluateApprovalReasons({ kind: 'train', train: null })).toEqual([]);
  });

  it('train: saver fare and separate tickets; flex alone is free', () => {
    expect(evaluateApprovalReasons({ kind: 'train', train: { fareType: 'saver', separateTickets: true } })).toEqual([
      'train_saver_fare',
      'train_separate_tickets',
    ]);
    expect(evaluateApprovalReasons({ kind: 'train', train: { fareType: 'flex', separateTickets: false } })).toEqual([]);
  });

  it('flights always need approval', () => {
    expect(evaluateApprovalReasons({ kind: 'flight' })).toEqual(['flight']);
  });

  it('special-equipment reason is required for car reasons only', () => {
    expect(specialEquipmentReasonRequired(['car_diesel'])).toBe(true);
    expect(specialEquipmentReasonRequired(['vehicle_class_upgrade'])).toBe(true);
    expect(specialEquipmentReasonRequired(['train_saver_fare', 'flight'])).toBe(false);
    expect(specialEquipmentReasonRequired([])).toBe(false);
  });
});

describe('buildRoute (SPEC_RESOLUTIONS #9)', () => {
  it('car: handover branch → destination', () => {
    expect(
      buildRoute({ kind: 'car', car: { handoverMode: 'branch', handoverBranch: 'Riverton', destination: 'Westbay' } }),
    ).toBe('Riverton → Westbay');
  });

  it('car delivery uses the delivery city', () => {
    expect(
      buildRoute({
        kind: 'car',
        car: { handoverMode: 'delivery', handoverBranch: null, handoverCity: 'Hillford', destination: 'Eastgate' },
      }),
    ).toBe('Hillford → Eastgate');
  });

  it('train includes the via station; flight uses the outbound leg', () => {
    expect(
      buildRoute({
        kind: 'train',
        train: { fromStation: 'Riverton Central', viaStation: 'Hillford Central', toStation: 'Eastgate Central' },
      }),
    ).toBe('Riverton Central → Hillford Central → Eastgate Central');
    expect(buildRoute({ kind: 'train', train: { fromStation: 'A', viaStation: null, toStation: 'B' } })).toBe('A → B');
    expect(
      buildRoute({ kind: 'flight', flight: { outboundFrom: 'Riverton Airport', outboundTo: 'Northport Airport' } }),
    ).toBe('Riverton Airport → Northport Airport');
  });
});

describe('isHighPriority (SPEC §5.2 + #11)', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

  it('pending / to-book trips starting within the window', () => {
    expect(isHighPriority('pending_approval', inDays(2), now, 3)).toBe(true);
    expect(isHighPriority('to_book', inDays(3), now, 3)).toBe(true);
    expect(isHighPriority('to_book', inDays(3.1), now, 3)).toBe(false);
  });

  it('never for booked or past trips', () => {
    expect(isHighPriority('booked', inDays(1), now, 3)).toBe(false);
    expect(isHighPriority('to_book', inDays(-0.1), now, 3)).toBe(false);
  });
});

describe('driver age', () => {
  it('is 18 on the birthday', () => {
    expect(isAdultOn('2008-10-20', '2026-10-20')).toBe(true);
    expect(isAdultOn('2008-10-21', '2026-10-20')).toBe(false);
  });
});

describe('PIN cipher (D12)', () => {
  const key = 'a'.repeat(64);

  it('round-trips and never stores the plain PIN', () => {
    const stored = encryptPin('4821', key);
    expect(stored).not.toContain('4821');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(decryptPin(stored, key)).toBe('4821');
  });

  it('uses a fresh IV per encryption and rejects tampering or a wrong key', () => {
    expect(encryptPin('4821', key)).not.toBe(encryptPin('4821', key));
    const stored = encryptPin('ABC123', key);
    expect(() => decryptPin(stored, 'b'.repeat(64))).toThrow();
    const parts = stored.split('.');
    parts[3] = Buffer.from('xxxx').toString('base64url');
    expect(() => decryptPin(parts.join('.'), key)).toThrow();
  });

  it('rejects truncated auth tags (no short-tag forgeries)', () => {
    const parts = encryptPin('4821', key).split('.');
    parts[2] = Buffer.from(parts[2] ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(() => decryptPin(parts.join('.'), key)).toThrow('Unsupported PIN format');
  });
});

describe('CSV', () => {
  it('quotes cells with separators and prefixes a BOM', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    const csv = toCsv(['A', 'B'], [[1, 'x']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('A,B\r\n1,x\r\n');
  });

  it('neutralises formula-like text (CSV injection) but leaves numbers alone', () => {
    expect(csvCell('=HYPERLINK("https://evil.example.com")')).toBe(`"'=HYPERLINK(""https://evil.example.com"")"`);
    for (const lead of ['+', '-', '@', '\t']) expect(csvCell(`${lead}1`)).toBe(`'${lead}1`);
    expect(csvCell('\r1')).toBe(`"'\r1"`);
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('Riverton')).toBe('Riverton');
  });
});
