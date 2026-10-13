/**
 * SPEC §10.4 catalogue (all names fictional): 7 device types, 8 manufacturers, 6 platforms and
 * 25 models. The frontend MSW fixtures mirror these values.
 */

export const SEED_DEVICE_TYPES = [
  { code: 'laptop', name: 'Laptop', requiresPlatform: true, sortOrder: 10 },
  { code: 'desktop', name: 'Desktop', requiresPlatform: true, sortOrder: 20 },
  { code: 'monitor', name: 'Monitor', requiresPlatform: false, sortOrder: 30 },
  { code: 'smartphone', name: 'Smartphone', requiresPlatform: true, sortOrder: 40 },
  { code: 'tablet', name: 'Tablet', requiresPlatform: true, sortOrder: 50 },
  { code: 'headset', name: 'Headset', requiresPlatform: false, sortOrder: 60 },
  { code: 'dock', name: 'Docking station', requiresPlatform: false, sortOrder: 70 },
] as const;

export type DeviceTypeCode = (typeof SEED_DEVICE_TYPES)[number]['code'];

export const SEED_MANUFACTURERS: { name: string; types: DeviceTypeCode[]; serialPrefix: string }[] = [
  { name: 'Vireo Computing', types: ['laptop', 'desktop', 'dock'], serialPrefix: 'VRC' },
  { name: 'Quillon Devices', types: ['laptop', 'tablet'], serialPrefix: 'QLD' },
  { name: 'Marlowe Mobile', types: ['smartphone', 'tablet'], serialPrefix: 'MRL' },
  { name: 'Skylark Displays', types: ['monitor'], serialPrefix: 'SKY' },
  { name: 'Corvane', types: ['monitor', 'dock'], serialPrefix: 'CVN' },
  { name: 'Brightfield Audio', types: ['headset'], serialPrefix: 'BFA' },
  { name: 'Tessaract Systems', types: ['laptop', 'desktop'], serialPrefix: 'TSS' },
  { name: 'Novaline Mobile', types: ['smartphone'], serialPrefix: 'NVL' },
];

export const SEED_PLATFORMS: { name: string; types: DeviceTypeCode[]; archived?: boolean }[] = [
  { name: 'Atlas Desktop 11', types: ['laptop', 'desktop'] },
  { name: 'Atlas Desktop 12', types: ['laptop', 'desktop'] },
  { name: 'Strata OS 15', types: ['laptop', 'desktop'] },
  { name: 'Pocket OS 17', types: ['smartphone', 'tablet'], archived: true },
  { name: 'Pocket OS 18', types: ['smartphone', 'tablet'] },
  { name: 'Verdant Mobile 14', types: ['smartphone', 'tablet'] },
];

export interface SeedModel {
  name: string;
  manufacturer: string;
  type: DeviceTypeCode;
  storageGb?: number;
  color?: string;
  archived?: boolean;
  /** Platform the holder installs on accept (devices that require one). */
  platform?: string;
}

export const SEED_MODELS: SeedModel[] = [
  // laptops (6, 1 archived)
  { name: 'Vireo Pro 14', manufacturer: 'Vireo Computing', type: 'laptop', platform: 'Strata OS 15' },
  { name: 'Vireo Air 13', manufacturer: 'Vireo Computing', type: 'laptop', platform: 'Strata OS 15' },
  {
    name: 'Vireo Pro 13 Classic',
    manufacturer: 'Vireo Computing',
    type: 'laptop',
    archived: true,
    platform: 'Atlas Desktop 11',
  },
  { name: 'Quillon Book 14', manufacturer: 'Quillon Devices', type: 'laptop', platform: 'Atlas Desktop 12' },
  { name: 'Tessaract Workbook 14', manufacturer: 'Tessaract Systems', type: 'laptop', platform: 'Atlas Desktop 12' },
  { name: 'Tessaract Workbook 16', manufacturer: 'Tessaract Systems', type: 'laptop', platform: 'Atlas Desktop 12' },
  // desktops (2)
  { name: 'Vireo Tower S', manufacturer: 'Vireo Computing', type: 'desktop', platform: 'Strata OS 15' },
  { name: 'Tessaract Mini D5', manufacturer: 'Tessaract Systems', type: 'desktop', platform: 'Atlas Desktop 11' },
  // monitors (4)
  { name: 'Skylark View 24', manufacturer: 'Skylark Displays', type: 'monitor' },
  { name: 'Skylark View 27', manufacturer: 'Skylark Displays', type: 'monitor' },
  { name: 'Corvane C27 QHD', manufacturer: 'Corvane', type: 'monitor' },
  { name: 'Corvane C34 Ultrawide', manufacturer: 'Corvane', type: 'monitor' },
  // smartphones (6, 1 archived) - storage and colour are part of the name
  {
    name: 'Marlowe X5 128 GB Midnight',
    manufacturer: 'Marlowe Mobile',
    type: 'smartphone',
    storageGb: 128,
    color: 'Midnight',
    platform: 'Pocket OS 18',
  },
  {
    name: 'Marlowe X5 256 GB Silver',
    manufacturer: 'Marlowe Mobile',
    type: 'smartphone',
    storageGb: 256,
    color: 'Silver',
    platform: 'Pocket OS 18',
  },
  {
    name: 'Marlowe X4 64 GB Graphite',
    manufacturer: 'Marlowe Mobile',
    type: 'smartphone',
    storageGb: 64,
    color: 'Graphite',
    archived: true,
    platform: 'Pocket OS 17',
  },
  {
    name: 'Novaline N8 128 GB Black',
    manufacturer: 'Novaline Mobile',
    type: 'smartphone',
    storageGb: 128,
    color: 'Black',
    platform: 'Verdant Mobile 14',
  },
  {
    name: 'Novaline N8 128 GB Ocean',
    manufacturer: 'Novaline Mobile',
    type: 'smartphone',
    storageGb: 128,
    color: 'Ocean',
    platform: 'Verdant Mobile 14',
  },
  {
    name: 'Novaline N9 256 GB Black',
    manufacturer: 'Novaline Mobile',
    type: 'smartphone',
    storageGb: 256,
    color: 'Black',
    platform: 'Verdant Mobile 14',
  },
  // tablets (3)
  {
    name: 'Quillon Slate 11 64 GB Silver',
    manufacturer: 'Quillon Devices',
    type: 'tablet',
    storageGb: 64,
    color: 'Silver',
    platform: 'Verdant Mobile 14',
  },
  {
    name: 'Quillon Slate 13 256 GB Graphite',
    manufacturer: 'Quillon Devices',
    type: 'tablet',
    storageGb: 256,
    color: 'Graphite',
    platform: 'Verdant Mobile 14',
  },
  {
    name: 'Marlowe Tab 10 128 GB Midnight',
    manufacturer: 'Marlowe Mobile',
    type: 'tablet',
    storageGb: 128,
    color: 'Midnight',
    platform: 'Pocket OS 18',
  },
  // headsets (2)
  { name: 'Brightfield Duo', manufacturer: 'Brightfield Audio', type: 'headset' },
  { name: 'Brightfield Solo', manufacturer: 'Brightfield Audio', type: 'headset' },
  // docks (2)
  { name: 'Vireo Dock U4', manufacturer: 'Vireo Computing', type: 'dock' },
  { name: 'Corvane Hub 8', manufacturer: 'Corvane', type: 'dock' },
];
