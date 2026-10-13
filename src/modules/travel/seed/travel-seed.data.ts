import type { ActingAs } from '@/common/domain/vocabulary';
import type { TravelKind, TravelStatus } from '../travel.constants';

/**
 * SPEC §10.3 travel seed: 40 requests. Story records S-V1..S-V13 carry the explicit reference
 * numbers TRV-000001..TRV-000013 (SPEC_RESOLUTIONS #21), filler records follow (14..40).
 * Times are `[dayOffset, hour, minute?]` relative to SEED_TODAY in APP_TIMEZONE.
 * People are persona keys or core seed handles (hilTech1, sdkAgent5, easLead, ito2, ...).
 */
export type At = [number, number, number?];

export interface CarClassSeed {
  code: string;
  name: string;
  description: string;
  exampleModels: string;
  vehicleType: 'car' | 'van';
  isDefault: boolean;
  sortOrder: number;
}

/** SPEC §4.3 seed classes (fictional example models). */
export const CAR_CLASSES: CarClassSeed[] = [
  {
    code: 'ECMR',
    name: 'Economy',
    description: 'Small 5-door car for one or two people and light luggage.',
    exampleModels: 'Kestrel City, Arlo One',
    vehicleType: 'car',
    isDefault: true,
    sortOrder: 10,
  },
  {
    code: 'CDMR',
    name: 'Compact',
    description: 'Compact car with room for four and two suitcases.',
    exampleModels: 'Kestrel Compact, Tamsin 3',
    vehicleType: 'car',
    isDefault: false,
    sortOrder: 20,
  },
  {
    code: 'IDAR',
    name: 'Intermediate automatic',
    description: 'Mid-size car with automatic transmission.',
    exampleModels: 'Arlo Sedan Auto',
    vehicleType: 'car',
    isDefault: false,
    sortOrder: 30,
  },
  {
    code: 'SWMR',
    name: 'Standard estate',
    description: 'Estate car for tools, samples or a lot of luggage.',
    exampleModels: 'Kestrel Estate, Tamsin 5 Touring',
    vehicleType: 'car',
    isDefault: false,
    sortOrder: 40,
  },
  {
    code: 'PDAR',
    name: 'Premium automatic',
    description: 'Premium car with automatic transmission for long distances.',
    exampleModels: 'Valmont GT Auto',
    vehicleType: 'car',
    isDefault: false,
    sortOrder: 50,
  },
  {
    code: 'XVMR',
    name: 'Small van',
    description: 'Panel van up to 3.5 t, about 6 m³ load space.',
    exampleModels: 'Pellow Cargo S',
    vehicleType: 'van',
    isDefault: true,
    sortOrder: 10,
  },
  {
    code: 'LVMR',
    name: 'Large van',
    description: 'High-roof van, about 12 m³ load space.',
    exampleModels: 'Pellow Cargo XL',
    vehicleType: 'van',
    isDefault: false,
    sortOrder: 20,
  },
];

export interface AddressSeed {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

export interface CarSpec {
  vehicleType?: 'car' | 'van';
  classCode: string;
  pickup: At;
  ret: At;
  destination: string;
  equipment?: Partial<
    Record<
      | 'estate'
      | 'navigation'
      | 'automaticPreferred'
      | 'automaticRequired'
      | 'diesel'
      | 'winterTyres'
      | 'foreignTravel'
      | 'childSeat',
      boolean
    >
  >;
  countries?: string[];
  /** Branch name, or an address for delivery. */
  handover: string | AddressSeed;
  /** Branch name, or an address for collection. Default: the handover branch. */
  dropOff?: string | AddressSeed;
  km?: number;
  payloadKg?: number;
  reason?: string;
}

export interface TrainSpec {
  trip: 'one_way' | 'return';
  out: At;
  ret?: At;
  from: string;
  via?: string;
  to: string;
  fare: 'saver' | 'flex';
  seats?: number;
  separate?: boolean;
  local?: boolean;
  companions?: string[];
  notes?: string;
}

export interface FlightSpec {
  trip: 'one_way' | 'return';
  out: At;
  from: string;
  to: string;
  ret?: At;
  handLuggage?: boolean;
  notes?: string;
}

export type SeedEvent =
  | { type: 'approve'; at: At; by?: string; as?: ActingAs; comment?: string }
  | { type: 'decline'; at: At; by?: string; reason: string }
  | { type: 'withdraw'; at: At; by?: string; reason?: string }
  | { type: 'book'; at: At; bookingNumber: string; pin?: string; comment?: string }
  | { type: 'mark_booking_impossible'; at: At; reason: string }
  | { type: 'request_cancellation'; at: At; by?: string; reason: string }
  | { type: 'confirm_cancellation'; at: At; comment?: string }
  | { type: 'close'; at: At; reason: string };

export type InAppKind = 'approval_requested' | 'submitted_to_desk' | 'approved' | 'declined' | 'booked';

export interface TripSpec {
  n: number;
  story?: string;
  kind: TravelKind;
  traveller: string;
  requester?: string;
  status: TravelStatus;
  created: At;
  car?: CarSpec;
  train?: TrainSpec;
  flight?: FlightSpec;
  comment?: string;
  costCenter?: { code: string; reason: string };
  recharge?: { customer: string; projectNumber: string };
  events?: SeedEvent[];
  /** In-app notifications of story records (SPEC_RESOLUTIONS #7). */
  inApp?: { to: string; kind: InAppKind; read?: boolean }[];
}

const branch = (city: string) => city;
const station = (city: string) => `${city} Central`;
const airport = (city: string) => `${city} Airport`;

export const TRIPS: TripSpec[] = [
  // ---------------------------------------------------------------- story records
  {
    n: 1,
    story: 'S-V1',
    kind: 'car',
    traveller: 'emma',
    status: 'pending_approval',
    created: [-1, 10, 12],
    car: {
      classCode: 'ECMR',
      pickup: [9, 8],
      ret: [11, 18],
      destination: 'Westbay',
      equipment: { automaticRequired: true, foreignTravel: true, navigation: true },
      countries: ['NL'],
      handover: branch('Riverton'),
      km: 280,
      reason: 'Customer workshop in Westbay with a detour across the border; I only drive automatic cars.',
    },
    comment: 'Customer workshop at the Westbay depot.',
    inApp: [{ to: 'max', kind: 'approval_requested' }],
  },
  {
    n: 2,
    story: 'S-V2',
    kind: 'train',
    traveller: 'emma',
    status: 'to_book',
    created: [0, 8, 5],
    train: {
      trip: 'return',
      out: [2, 7, 40],
      ret: [2, 18, 10],
      from: station('Riverton'),
      to: station('Hillford'),
      fare: 'flex',
      seats: 1,
    },
    comment: 'Site visit Hillford.',
    inApp: [{ to: 'emma', kind: 'submitted_to_desk' }],
  },
  {
    n: 3,
    story: 'S-V3',
    kind: 'flight',
    traveller: 'emma',
    status: 'booked',
    created: [-6, 9, 30],
    flight: {
      trip: 'return',
      out: [16, 7, 15],
      from: airport('Riverton'),
      to: airport('Northport'),
      ret: [18, 17, 45],
      handLuggage: true,
    },
    comment: 'Field service partner meeting in Northport.',
    events: [
      { type: 'approve', at: [-5, 11], comment: 'Approved - please keep to hand luggage.' },
      { type: 'book', at: [-4, 14, 20], bookingNumber: 'QX7H2L', pin: '4821' },
    ],
    inApp: [{ to: 'emma', kind: 'booked', read: true }],
  },
  {
    n: 4,
    story: 'S-V4',
    kind: 'car',
    traveller: 'emma',
    status: 'booked',
    created: [-36, 9],
    car: {
      classCode: 'ECMR',
      pickup: [-30, 8],
      ret: [-29, 17],
      destination: 'Southmere',
      handover: branch('Riverton'),
    },
    events: [{ type: 'book', at: [-33, 10, 30], bookingNumber: 'RC48201' }],
  },
  {
    n: 5,
    story: 'S-V5',
    kind: 'train',
    traveller: 'emma',
    status: 'cancelled',
    created: [-12, 15],
    train: {
      trip: 'return',
      out: [5, 6, 50],
      ret: [5, 19, 20],
      from: station('Riverton'),
      to: station('Eastgate'),
      fare: 'saver',
    },
    events: [{ type: 'withdraw', at: [-11, 9, 10], reason: 'The meeting moved to a video call.' }],
  },
  {
    n: 6,
    story: 'S-V6',
    kind: 'car',
    traveller: 'emma',
    status: 'declined',
    created: [-8, 11],
    car: {
      classCode: 'IDAR',
      pickup: [12, 8],
      ret: [13, 18],
      destination: 'Highmoor',
      handover: branch('Riverton'),
      reason: 'More comfortable for the long drive with sample cases.',
    },
    events: [{ type: 'decline', at: [-7, 9, 40], reason: 'Standard class is sufficient for this trip.' }],
    inApp: [{ to: 'emma', kind: 'declined', read: true }],
  },
  {
    n: 7,
    story: 'S-V7',
    kind: 'train',
    traveller: 'sofia',
    status: 'to_book',
    created: [-2, 16],
    train: {
      trip: 'return',
      out: [1, 7, 10],
      ret: [1, 19, 5],
      from: station('Hillford'),
      to: station('Riverton'),
      fare: 'saver',
      seats: 1,
    },
    comment: 'Monthly site managers meeting at headquarters.',
    events: [{ type: 'approve', at: [-1, 8, 30] }],
    inApp: [{ to: 'sofia', kind: 'approved' }],
  },
  {
    n: 8,
    story: 'S-V8',
    kind: 'car',
    traveller: 'hilTech1',
    status: 'pending_approval',
    created: [-1, 14],
    car: {
      vehicleType: 'van',
      classCode: 'XVMR',
      pickup: [6, 7],
      ret: [8, 17],
      destination: 'Eastgate',
      handover: { street: 'Mill Lane', houseNumber: '14', postalCode: '20417', city: 'Hillford', countryCode: 'DE' },
      dropOff: branch('Hillford'),
      payloadKg: 800,
      reason: 'Spare parts for the Eastgate rollout have to be loaded at the Hillford depot.',
    },
    inApp: [],
  },
  {
    n: 9,
    story: 'S-V9',
    kind: 'car',
    traveller: 'hilTech2',
    status: 'pending_approval',
    created: [0, 7, 45],
    car: {
      classCode: 'ECMR',
      pickup: [2, 8],
      ret: [4, 17],
      destination: 'Southmere',
      equipment: { diesel: true },
      handover: branch('Hillford'),
      km: 420,
      reason: 'Long motorway distances - a diesel keeps fuel costs down.',
    },
    inApp: [{ to: 'max', kind: 'approval_requested' }],
  },
  {
    n: 10,
    story: 'S-V10',
    kind: 'flight',
    traveller: 'clara',
    status: 'to_book',
    created: [-1, 18],
    flight: { trip: 'return', out: [5, 8, 20], from: airport('Riverton'), to: airport('Lakeside'), ret: [6, 19, 0] },
    comment: 'Board meeting Lakeside.',
    inApp: [{ to: 'clara', kind: 'submitted_to_desk', read: true }],
  },
  {
    n: 11,
    story: 'S-V11',
    kind: 'train',
    traveller: 'sdkAgent5',
    status: 'pending_approval',
    created: [-1, 9, 15],
    train: {
      trip: 'return',
      out: [8, 6, 55],
      ret: [9, 18, 40],
      from: station('Riverton'),
      to: station('Northport'),
      fare: 'saver',
      seats: 1,
    },
    comment: 'Service desk tooling training in Northport.',
    inApp: [{ to: 'max', kind: 'approval_requested' }],
  },
  {
    n: 12,
    story: 'S-V12',
    kind: 'flight',
    traveller: 'victor',
    status: 'pending_approval',
    created: [-2, 13],
    flight: { trip: 'return', out: [14, 7, 5], from: airport('Riverton'), to: airport('Northport'), ret: [15, 20, 10] },
    comment: 'Data centre audit in Northport.',
    inApp: [{ to: 'clara', kind: 'approval_requested' }],
  },
  {
    n: 13,
    story: 'S-V13',
    kind: 'car',
    traveller: 'rivDispatcher',
    status: 'to_book',
    created: [0, 9, 20],
    car: { classCode: 'ECMR', pickup: [1, 8], ret: [1, 18], destination: 'Oakridge', handover: branch('Riverton') },
  },

  // ---------------------------------------------------------------- filler: pending approval
  {
    n: 14,
    kind: 'car',
    traveller: 'easTech1',
    status: 'pending_approval',
    created: [-2, 10],
    car: {
      classCode: 'SWMR',
      pickup: [10, 7],
      ret: [12, 18],
      destination: 'Lakeside',
      equipment: { estate: true },
      handover: branch('Eastgate'),
      reason: 'Measuring equipment and two ladders have to fit in the car.',
    },
  },
  {
    n: 15,
    kind: 'train',
    traveller: 'rivSeniorTech',
    status: 'pending_approval',
    created: [-1, 11],
    train: {
      trip: 'one_way',
      out: [7, 6, 30],
      from: station('Riverton'),
      via: station('Hillford'),
      to: station('Eastgate'),
      fare: 'flex',
      separate: true,
      seats: 2,
      companions: ['easTech2'],
    },
  },
  {
    n: 16,
    kind: 'flight',
    traveller: 'sdkAgent2',
    status: 'pending_approval',
    created: [-3, 15],
    flight: {
      trip: 'return',
      out: [19, 9, 0],
      from: airport('Riverton'),
      to: airport('Westbay'),
      ret: [20, 18, 30],
      handLuggage: true,
    },
  },

  // ---------------------------------------------------------------- filler: to book
  {
    n: 17,
    kind: 'car',
    traveller: 'ito2',
    status: 'to_book',
    created: [-4, 10],
    car: {
      classCode: 'CDMR',
      pickup: [12, 8],
      ret: [14, 17],
      destination: 'Highmoor',
      handover: branch('Riverton'),
      reason: 'Two colleagues and server hardware for the Highmoor office.',
    },
    events: [{ type: 'approve', at: [-3, 9] }],
  },
  {
    n: 18,
    kind: 'car',
    traveller: 'fin1',
    status: 'to_book',
    created: [-5, 14],
    car: {
      classCode: 'ECMR',
      pickup: [20, 8],
      ret: [21, 18],
      destination: 'Oakridge',
      equipment: { automaticPreferred: true },
      handover: branch('Riverton'),
      reason: 'Automatic preferred for city traffic in Oakridge.',
    },
    events: [{ type: 'approve', at: [-4, 10] }],
  },
  {
    n: 19,
    kind: 'train',
    traveller: 'ppl1',
    status: 'to_book',
    created: [-1, 12],
    train: {
      trip: 'return',
      out: [8, 8, 15],
      ret: [8, 17, 45],
      from: station('Riverton'),
      to: station('Southmere'),
      fare: 'flex',
      local: true,
    },
  },
  {
    n: 20,
    kind: 'train',
    traveller: 'sdkAgent6',
    status: 'to_book',
    created: [-3, 9],
    train: {
      trip: 'return',
      out: [15, 7, 0],
      ret: [16, 19, 0],
      from: station('Riverton'),
      to: station('Lakeside'),
      fare: 'saver',
    },
    events: [{ type: 'approve', at: [-1, 10], by: 'max', as: 'deputy', comment: 'Approved as deputy for Priya.' }],
  },
  {
    n: 21,
    kind: 'flight',
    traveller: 'paula',
    status: 'to_book',
    created: [-6, 10],
    flight: { trip: 'return', out: [25, 7, 30], from: airport('Riverton'), to: airport('Southmere'), ret: [26, 18, 0] },
    events: [{ type: 'approve', at: [-5, 15] }],
  },

  // ---------------------------------------------------------------- filler: booked
  {
    n: 22,
    kind: 'car',
    traveller: 'rivSeniorTech',
    status: 'booked',
    created: [-20, 9],
    car: { classCode: 'ECMR', pickup: [-12, 7], ret: [-11, 18], destination: 'Highmoor', handover: branch('Riverton') },
    events: [{ type: 'book', at: [-18, 11], bookingNumber: 'RC48377' }],
  },
  {
    n: 23,
    kind: 'car',
    traveller: 'hilTech3',
    status: 'booked',
    created: [-9, 10],
    car: {
      vehicleType: 'van',
      classCode: 'LVMR',
      pickup: [22, 7],
      ret: [24, 17],
      destination: 'Northport',
      handover: branch('Hillford'),
      payloadKg: 1200,
      reason: 'Rack cabinets for the Northport rollout need the high-roof van.',
    },
    events: [
      { type: 'approve', at: [-8, 9] },
      { type: 'book', at: [-7, 14], bookingNumber: 'VN20914' },
    ],
  },
  {
    n: 24,
    kind: 'car',
    traveller: 'easLead',
    status: 'booked',
    created: [-7, 13],
    car: {
      classCode: 'ECMR',
      pickup: [6, 8],
      ret: [7, 18],
      destination: 'Riverton',
      handover: branch('Eastgate'),
      equipment: { winterTyres: true },
    },
    events: [{ type: 'book', at: [-6, 10], bookingNumber: 'RC48512' }],
  },
  {
    n: 25,
    kind: 'car',
    traveller: 'ito1',
    status: 'booked',
    created: [-10, 9],
    car: {
      classCode: 'ECMR',
      pickup: [14, 8],
      ret: [16, 17],
      destination: 'Westbay',
      handover: branch('Riverton'),
      equipment: { navigation: true },
    },
    events: [{ type: 'book', at: [-9, 15], bookingNumber: 'RC48633' }],
  },
  {
    n: 26,
    kind: 'car',
    traveller: 'arne',
    status: 'booked',
    created: [-11, 10],
    car: {
      classCode: 'ECMR',
      pickup: [30, 8],
      ret: [31, 18],
      destination: 'Lakeside',
      handover: branch('Riverton'),
      equipment: { childSeat: true },
    },
    events: [{ type: 'book', at: [-10, 11], bookingNumber: 'RC48710' }],
  },
  {
    n: 27,
    kind: 'train',
    traveller: 'sdkAgent1',
    status: 'booked',
    created: [-26, 10],
    train: {
      trip: 'return',
      out: [-20, 7, 20],
      ret: [-20, 18, 50],
      from: station('Riverton'),
      to: station('Hillford'),
      fare: 'flex',
    },
    events: [{ type: 'book', at: [-25, 9], bookingNumber: 'TK903311' }],
  },
  {
    n: 28,
    kind: 'train',
    traveller: 'ppl2',
    status: 'booked',
    created: [-5, 11],
    train: {
      trip: 'return',
      out: [4, 8, 0],
      ret: [4, 17, 30],
      from: station('Riverton'),
      to: station('Oakridge'),
      fare: 'flex',
      seats: 1,
    },
    events: [{ type: 'book', at: [-4, 9, 30], bookingNumber: 'TK903587' }],
  },
  {
    n: 29,
    kind: 'train',
    traveller: 'rivDispatcher',
    status: 'booked',
    created: [-8, 9],
    train: {
      trip: 'return',
      out: [10, 7, 35],
      ret: [11, 18, 15],
      from: station('Riverton'),
      to: station('Highmoor'),
      fare: 'flex',
      seats: 3,
      companions: ['emma', 'rivSeniorTech'],
      notes: 'Three seats together, please.',
    },
    events: [{ type: 'book', at: [-6, 14], bookingNumber: 'TK903642' }],
  },
  {
    n: 30,
    kind: 'train',
    traveller: 'victor',
    status: 'booked',
    created: [-9, 16],
    train: { trip: 'one_way', out: [18, 9, 10], from: station('Riverton'), to: station('Westbay'), fare: 'flex' },
    events: [{ type: 'book', at: [-8, 10], bookingNumber: 'TK903720' }],
  },
  {
    n: 31,
    kind: 'flight',
    traveller: 'helen',
    status: 'booked',
    created: [-70, 9],
    flight: {
      trip: 'return',
      out: [-60, 7, 0],
      from: airport('Riverton'),
      to: airport('Highmoor'),
      ret: [-58, 19, 30],
    },
    events: [{ type: 'book', at: [-68, 15], bookingNumber: 'FL7K2M9', pin: '5530' }],
  },

  // ---------------------------------------------------------------- filler: declined
  {
    n: 32,
    kind: 'car',
    traveller: 'hilTech4',
    status: 'declined',
    created: [-4, 8],
    car: {
      classCode: 'ECMR',
      pickup: [9, 7],
      ret: [10, 17],
      destination: 'Lakeside',
      equipment: { diesel: true },
      handover: branch('Hillford'),
      reason: 'I prefer diesel for the motorway stretch.',
    },
    events: [{ type: 'decline', at: [-3, 9], reason: 'Please share the Lakeside trip with the team van on that day.' }],
  },
  {
    n: 33,
    kind: 'flight',
    traveller: 'ito3',
    status: 'declined',
    created: [-15, 14],
    flight: { trip: 'one_way', out: [3, 6, 40], from: airport('Riverton'), to: airport('Oakridge') },
    events: [{ type: 'decline', at: [-14, 10], reason: 'The train is fast enough for Oakridge.' }],
  },

  // ---------------------------------------------------------------- filler: booking impossible (retry-able, start >= d+7)
  {
    n: 34,
    kind: 'car',
    traveller: 'hilTech5',
    status: 'booking_impossible',
    created: [-3, 10],
    car: {
      vehicleType: 'van',
      classCode: 'LVMR',
      pickup: [9, 7],
      ret: [10, 17],
      destination: 'Riverton',
      handover: branch('Hillford'),
      payloadKg: 1000,
      reason: 'Return of old hardware to the Riverton warehouse.',
    },
    events: [
      { type: 'approve', at: [-2, 9] },
      {
        type: 'mark_booking_impossible',
        at: [-1, 11],
        reason: 'No large vans available at the Hillford branch on these dates.',
      },
    ],
  },
  {
    n: 35,
    kind: 'train',
    traveller: 'ppl4',
    status: 'booking_impossible',
    created: [-4, 9],
    train: {
      trip: 'return',
      out: [11, 6, 45],
      ret: [12, 19, 0],
      from: station('Riverton'),
      to: station('Northport'),
      fare: 'flex',
      seats: 1,
    },
    events: [
      { type: 'mark_booking_impossible', at: [-2, 15], reason: 'Seat reservations are sold out for this connection.' },
    ],
  },

  // ---------------------------------------------------------------- filler: cancellation requested
  {
    n: 36,
    kind: 'car',
    traveller: 'easTech3',
    status: 'cancellation_requested',
    created: [-5, 9],
    car: { classCode: 'ECMR', pickup: [7, 8], ret: [8, 18], destination: 'Highmoor', handover: branch('Eastgate') },
    events: [{ type: 'request_cancellation', at: [-1, 16], reason: 'The customer postponed the installation.' }],
  },
  {
    n: 37,
    kind: 'train',
    traveller: 'sdkAgent7',
    status: 'cancellation_requested',
    created: [-9, 10],
    train: {
      trip: 'return',
      out: [2, 7, 5],
      ret: [2, 18, 0],
      from: station('Riverton'),
      to: station('Westbay'),
      fare: 'flex',
    },
    events: [
      { type: 'book', at: [-8, 9], bookingNumber: 'TK904118' },
      { type: 'request_cancellation', at: [0, 8, 15], reason: 'I am ill and cannot travel.' },
    ],
  },
  {
    n: 38,
    kind: 'flight',
    traveller: 'ito4',
    status: 'cancellation_requested',
    created: [-14, 11],
    flight: { trip: 'return', out: [13, 7, 50], from: airport('Riverton'), to: airport('Lakeside'), ret: [14, 18, 20] },
    events: [
      { type: 'approve', at: [-13, 10] },
      { type: 'book', at: [-12, 14], bookingNumber: 'FL7P4Q1', pin: '9067' },
      { type: 'request_cancellation', at: [-1, 10], reason: 'The vendor workshop was cancelled.' },
    ],
  },

  // ---------------------------------------------------------------- filler: cancelled
  {
    n: 39,
    kind: 'train',
    traveller: 'sdkAgent3',
    status: 'cancelled',
    created: [-16, 10],
    train: {
      trip: 'return',
      out: [3, 7, 0],
      ret: [3, 17, 0],
      from: station('Riverton'),
      to: station('Southmere'),
      fare: 'flex',
    },
    events: [
      { type: 'book', at: [-15, 11], bookingNumber: 'TK903955' },
      { type: 'request_cancellation', at: [-6, 9], reason: 'The training moved online.' },
      { type: 'confirm_cancellation', at: [-5, 10], comment: 'Tickets refunded.' },
    ],
  },
  {
    n: 40,
    kind: 'car',
    traveller: 'ppl3',
    status: 'cancelled',
    created: [-10, 9],
    car: { classCode: 'ECMR', pickup: [4, 8], ret: [4, 18], destination: 'Eastgate', handover: branch('Riverton') },
    events: [
      { type: 'mark_booking_impossible', at: [-8, 10], reason: 'No cars available at the Riverton branch that day.' },
      { type: 'close', at: [-7, 9], reason: 'The colleague will join the team car instead.' },
    ],
  },
];
