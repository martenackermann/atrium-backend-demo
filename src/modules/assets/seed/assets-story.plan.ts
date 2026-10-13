/**
 * SPEC §10.4 assets as event histories: every asset is described by the transitions it went
 * through (day offsets relative to SEED_TODAY). The seeder replays them, so state, assignments,
 * audit rows and timelines are always coherent. 120 assets:
 * in_use 82 · pending_acceptance 4 · in_stock 22 · in_repair 5 · scrapped 7 (2 soft-deleted);
 * laptop 40 · monitor 30 · smartphone 22 · desktop 8 · tablet 8 · headset 8 · dock 4.
 * Story records carry explicit asset numbers (SPEC_RESOLUTIONS #21).
 */

export type SeedEvent =
  | { t: 'create'; day: number; by?: string }
  | { t: 'assign'; day: number; to: string; by?: string; note?: string }
  /** `cc` = the user's cost centre at that time (when it differs from today's, a sync follows). */
  | { t: 'accept'; day: number; cc?: string }
  | { t: 'decline'; day: number; reason: string }
  | { t: 'unassign'; day: number; reason?: string; by?: string }
  | { t: 'return'; day: number; condition: 'ok' | 'damaged'; note?: string; by?: string }
  | { t: 'send_to_repair'; day: number; note: string; by?: string }
  | { t: 'complete_repair'; day: number; note?: string; by?: string }
  | { t: 'scrap'; day: number; reason: string; by?: string }
  | { t: 'delete'; day: number; by?: string }
  | { t: 'update'; day: number; by?: string; set: { serialNumber?: 'fix_typo'; notes?: string; name?: string } }
  | { t: 'cost_center_sync'; day: number; to: string }
  /** System reminder; the seeder moves it to a weekday (SPEC_RESOLUTIONS #21). */
  | { t: 'remind'; day: number };

export interface SeedAssetSpec {
  /** Story id (S-A1...) for documentation and MSW parity. */
  story?: string;
  /** Explicit asset number for story records. */
  number?: number;
  model: string;
  events: SeedEvent[];
}

/** Persona devices: [handle, model, created day offset, later events (e.g. a return)]. */
type Holding = [string, string, number, SeedEvent[]?];

/**
 * Back-office device swaps (in-app notifications for the personas, SPEC §10.1): a returned
 * device from stock goes to the persona, whose old device comes back to stock. Status and
 * type counts stay as in SPEC §10.4, and stock still holds 3 returned devices.
 */
const SWAP = {
  tom: { assign: -6, returnOld: -5 },
  arne: { assign: -8, returnOld: -7 },
  ian: { assign: -2, returnOld: -1 },
} as const;

const inUse = (to: string, model: string, created: number, extra: SeedEvent[] = [], cc?: string): SeedAssetSpec => ({
  model,
  events: [
    { t: 'create', day: created },
    { t: 'assign', day: created + 2, to },
    { t: 'accept', day: created + 3, cc },
    ...extra,
  ],
});

/** Builds the 120 asset histories. `pick(min, max)` must be deterministic (seeded faker). */
export function planAssets(pick: (min: number, max: number) => number): SeedAssetSpec[] {
  const assets: SeedAssetSpec[] = [];

  // --- Emma: S-A1..S-A4 ---------------------------------------------------------------
  assets.push({
    story: 'S-A1',
    number: 118,
    model: 'Vireo Pro 14',
    events: [
      { t: 'create', day: -6 },
      { t: 'assign', day: -1, to: 'emma', note: 'Pre-installed with the field-service toolkit.' },
    ],
  });
  assets.push({
    story: 'S-A2',
    number: 115,
    model: 'Marlowe X5 128 GB Midnight',
    events: [
      { t: 'create', day: -12 },
      { t: 'assign', day: -4, to: 'emma' },
      { t: 'remind', day: -1 },
    ],
  });
  assets.push({
    story: 'S-A3',
    number: 64,
    ...inUse('emma', 'Skylark View 27', -420, [{ t: 'update', day: -300, set: { serialNumber: 'fix_typo' } }]),
  });
  assets.push({ story: 'S-A4', number: 71, ...inUse('emma', 'Brightfield Duo', -380) });

  // --- the other personas (2-4 devices each) -------------------------------------------
  const personaHoldings: Holding[] = [
    ['max', 'Skylark View 27', -540],
    ['sofia', 'Quillon Book 14', -480],
    ['sofia', 'Marlowe X5 256 GB Silver', -360],
    ['sofia', 'Quillon Slate 11 64 GB Silver', -250],
    ['clara', 'Vireo Air 13', -200],
    ['clara', 'Marlowe X5 256 GB Silver', -190],
    ['clara', 'Marlowe Tab 10 128 GB Midnight', -160],
    ['clara', 'Corvane C34 Ultrawide', -600],
    ['tom', 'Tessaract Workbook 14', -700],
    [
      'tom',
      'Skylark View 24',
      -700,
      [{ t: 'return', day: SWAP.tom.returnOld, condition: 'ok', note: 'Replaced by a 27-inch monitor.' }],
    ],
    ['tom', 'Brightfield Solo', -420],
    ['tina', 'Vireo Air 13', -330],
    ['tina', 'Skylark View 24', -650],
    [
      'arne',
      'Vireo Pro 14',
      -260,
      [{ t: 'return', day: SWAP.arne.returnOld, condition: 'ok', note: 'Replaced by a re-imaged Quillon Book 14.' }],
    ],
    ['arne', 'Novaline N9 256 GB Black', -140],
    ['arne', 'Corvane C27 QHD', -500],
    ['arne', 'Vireo Dock U4', -260],
    ['paula', 'Quillon Book 14', -410],
    ['paula', 'Skylark View 24', -610],
    ['paula', 'Brightfield Duo', -300],
    ['ian', 'Tessaract Workbook 16', -230],
    ['ian', 'Corvane C34 Ultrawide', -560],
    [
      'ian',
      'Novaline N8 128 GB Ocean',
      -330,
      [{ t: 'return', day: SWAP.ian.returnOld, condition: 'ok', note: 'Replaced by a phone with more storage.' }],
    ],
  ];
  for (const [to, model, created, extra] of personaHoldings) assets.push(inUse(to, model, created, extra));
  assets.push(
    inUse('max', 'Vireo Pro 14', -540, [
      { t: 'update', day: -200, set: { notes: 'Battery replaced under warranty.' } },
    ]),
  );
  // Max's phone is in repair but stays his (it returns to him after the repair).
  assets.push(
    inUse('max', 'Novaline N8 128 GB Black', -300, [
      { t: 'send_to_repair', day: -5, note: 'Cracked screen after a site visit; courier pickup booked.' },
    ]),
  );
  assets.push(
    inUse('ian', 'Tessaract Mini D5', -560, [{ t: 'update', day: -400, by: 'ian', set: { name: 'ITO-ADMIN-01' } }]),
  );

  // --- other pending acceptances ---------------------------------------------------------
  assets.push({
    model: 'Quillon Slate 11 64 GB Silver',
    events: [
      { t: 'create', day: -20 },
      { t: 'assign', day: -10, to: 'hilTech2', note: 'Tablet for the digital job sheets.' },
      { t: 'remind', day: -7 },
      { t: 'remind', day: -4 },
      { t: 'remind', day: -1 },
    ],
  });
  assets.push({
    model: 'Brightfield Solo',
    events: [
      { t: 'create', day: -90 },
      { t: 'assign', day: -2, to: 'sdkAgent5', by: 'ito5' },
    ],
  });

  // --- other in repair -----------------------------------------------------------------------
  assets.push(
    inUse('rivSeniorTech', 'Tessaract Workbook 14', -640, [
      { t: 'send_to_repair', day: -9, note: 'Fan noise and overheating under load.' },
    ]),
  );
  assets.push(
    inUse('hilTech6', 'Vireo Pro 13 Classic', -1100, [
      { t: 'return', day: -15, condition: 'damaged', note: 'Hinge broken.' },
    ]),
  );
  assets.push({
    model: 'Novaline N8 128 GB Black',
    events: [
      { t: 'create', day: -200 },
      { t: 'send_to_repair', day: -25, note: 'Does not charge.' },
    ],
  });
  assets.push(
    inUse('formerHilTech', 'Marlowe Tab 10 128 GB Midnight', -280, [
      { t: 'return', day: -60, condition: 'damaged', note: 'Screen cracked. Returned at the end of employment.' },
    ]),
  );

  // --- scrapped (2 also soft-deleted) ----------------------------------------------------
  assets.push(
    inUse('formerSdkAgent', 'Vireo Pro 13 Classic', -1300, [
      { t: 'return', day: -400, condition: 'damaged', note: 'Does not power on.' },
      { t: 'scrap', day: -380, reason: 'Mainboard failure; repair not economical.' },
      { t: 'delete', day: -200 },
    ]),
  );
  assets.push(
    inUse('sdkAgent6', 'Vireo Pro 13 Classic', -1250, [
      { t: 'return', day: -500, condition: 'ok' },
      { t: 'scrap', day: -450, reason: 'End of life: battery health below 60 %.' },
    ]),
  );
  assets.push({
    model: 'Tessaract Workbook 14',
    events: [
      { t: 'create', day: -900 },
      { t: 'send_to_repair', day: -300, note: 'Liquid damage.' },
      { t: 'scrap', day: -280, reason: 'Liquid damage; not repairable.' },
    ],
  });
  assets.push({
    model: 'Skylark View 24',
    events: [
      { t: 'create', day: -1200 },
      { t: 'update', day: -700, set: { notes: 'Dead pixels across the lower edge.' } },
      { t: 'scrap', day: -690, reason: 'Dead pixels; out of warranty.' },
      { t: 'delete', day: -600 },
    ],
  });
  assets.push(
    inUse('fin3', 'Corvane C27 QHD', -1000, [
      { t: 'return', day: -350, condition: 'damaged', note: 'Backlight flickers.' },
      { t: 'scrap', day: -340, reason: 'Backlight failure.' },
    ]),
  );
  assets.push(
    inUse('easTech4', 'Marlowe X4 64 GB Graphite', -1000, [
      { t: 'return', day: -420, condition: 'ok' },
      { t: 'scrap', day: -410, reason: 'Pocket OS 17 is no longer supported.' },
    ]),
  );
  assets.push({
    model: 'Brightfield Solo',
    events: [
      { t: 'create', day: -800 },
      { t: 'scrap', day: -150, reason: 'Cable damaged.' },
    ],
  });

  // --- in stock (22; 3 returned, 1 declined, 1 unassigned) -----------------------------------
  const stock = (model: string, created: number): SeedAssetSpec => ({ model, events: [{ t: 'create', day: created }] });
  assets.push(stock('Vireo Pro 14', -6), stock('Vireo Pro 14', -6), stock('Tessaract Workbook 16', -30));
  assets.push(stock('Vireo Pro 13 Classic', -1150));
  // The three returned devices go out again in the back-office swaps (SWAP); the personas'
  // old devices take their place in stock.
  assets.push(
    inUse('formerSdkAgent', 'Quillon Book 14', -700, [
      { t: 'return', day: -130, condition: 'ok' },
      { t: 'update', day: -129, set: { notes: 'Wiped and re-imaged; ready for re-use.' } },
      { t: 'assign', day: SWAP.arne.assign, to: 'arne', by: 'ito5' },
      { t: 'accept', day: SWAP.arne.assign },
    ]),
  );
  assets.push({
    model: 'Vireo Air 13',
    events: [
      { t: 'create', day: -45 },
      { t: 'assign', day: -20, to: 'sdkAgent7', by: 'ito5' },
      { t: 'decline', day: -19, reason: 'I work at a fixed desk and asked for a desktop instead.' },
    ],
  });
  assets.push(stock('Skylark View 24', -90), stock('Skylark View 24', -90), stock('Skylark View 24', -90));
  assets.push(stock('Skylark View 27', -90), stock('Skylark View 27', -90));
  assets.push(
    inUse('sdkAgent4', 'Skylark View 27', -500, [
      { t: 'return', day: -20, condition: 'ok' },
      { t: 'assign', day: SWAP.tom.assign, to: 'tom', note: 'Larger screen for the booking tools.' },
      { t: 'accept', day: SWAP.tom.assign },
    ]),
  );
  assets.push(stock('Corvane C27 QHD', -300));
  assets.push({
    model: 'Corvane C34 Ultrawide',
    events: [
      { t: 'create', day: -120 },
      { t: 'assign', day: -50, to: 'fin2' },
      { t: 'unassign', day: -48, reason: 'Assigned by mistake.' },
    ],
  });
  assets.push(stock('Novaline N9 256 GB Black', -40), stock('Marlowe X5 128 GB Midnight', -12));
  assets.push(
    inUse('easTech4', 'Marlowe X5 256 GB Silver', -400, [
      { t: 'return', day: -12, condition: 'ok', note: 'Moved to a desk role.' },
      { t: 'assign', day: SWAP.ian.assign, to: 'ian' },
      { t: 'accept', day: SWAP.ian.assign },
    ]),
  );
  assets.push(stock('Vireo Tower S', -200));
  assets.push(stock('Quillon Slate 13 256 GB Graphite', -60), stock('Quillon Slate 11 64 GB Silver', -20));
  assets.push(stock('Brightfield Duo', -150), stock('Corvane Hub 8', -200));

  // --- everyone else's devices in use (55) ------------------------------------------------
  const rotation: Record<string, string[]> = {
    laptop: ['Vireo Pro 14', 'Quillon Book 14', 'Tessaract Workbook 14', 'Vireo Air 13', 'Tessaract Workbook 16'],
    desktop: ['Tessaract Mini D5', 'Vireo Tower S'],
    monitor: ['Skylark View 24', 'Skylark View 27', 'Corvane C27 QHD', 'Corvane C34 Ultrawide'],
    smartphone: [
      'Novaline N8 128 GB Black',
      'Marlowe X5 128 GB Midnight',
      'Novaline N8 128 GB Ocean',
      'Marlowe X5 256 GB Silver',
      'Novaline N9 256 GB Black',
    ],
    tablet: ['Quillon Slate 13 256 GB Graphite', 'Marlowe Tab 10 128 GB Midnight'],
    headset: ['Brightfield Duo', 'Brightfield Solo'],
    dock: ['Vireo Dock U4', 'Corvane Hub 8'],
  };
  const holders: Record<string, string[]> = {
    laptop: [
      'priya',
      'victor',
      'helen',
      'grace',
      'exoAssistant',
      'ito1',
      'ito2',
      'ito3',
      'ito4',
      'ito5',
      'sdkLead',
      'easLead',
      'rivDispatcher',
      'ppl1',
      'ppl3',
      'hilTech1',
      'hilTech3',
      'easTech1',
      'easTech2',
      'sdkAgent1',
    ],
    desktop: ['fin1', 'fin2', 'fin3', 'fin4', 'ppl2', 'ppl4'],
    monitor: [
      'priya',
      'victor',
      'helen',
      'grace',
      'exoAssistant',
      'ito1',
      'ito2',
      'fin1',
      'fin2',
      'sdkLead',
      'sdkAgent1',
      'sdkAgent2',
    ],
    smartphone: [
      'priya',
      'victor',
      'helen',
      'grace',
      'easLead',
      'rivDispatcher',
      'rivSeniorTech',
      'hilTech1',
      'hilTech3',
      'easTech1',
      'easTech2',
    ],
    tablet: ['hilTech4', 'easTech3'],
    headset: ['sdkAgent2', 'sdkAgent3'],
    dock: ['ito1', 'ito2'],
  };
  for (const [type, people] of Object.entries(holders)) {
    people.forEach((to, i) => {
      const model = rotation[type][i % rotation[type].length];
      const created = -pick(60, 900);
      if (type === 'laptop' && to === 'victor') {
        assets.push(inUse(to, model, created, [{ t: 'update', day: created + 10, set: { serialNumber: 'fix_typo' } }]));
      } else if (type === 'laptop' && to === 'rivDispatcher') {
        // Moved from Eastgate to Riverton: the nightly job synced the device's cost centre.
        assets.push(inUse(to, model, -480, [{ t: 'cost_center_sync', day: -120, to: 'CC-2100' }], 'CC-2300'));
      } else if (type === 'laptop' && to === 'ppl3') {
        assets.push(inUse(to, model, -260, [{ t: 'cost_center_sync', day: -75, to: 'CC-6100' }], 'CC-5100'));
      } else {
        assets.push(inUse(to, model, created));
      }
    });
  }

  return assets;
}
