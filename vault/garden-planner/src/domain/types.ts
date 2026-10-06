// Garden Planner domain model. Metres everywhere. Plan +Y is "up" on screen; `northDeg` says which way true north points relative to that
// (0 = plan up is north; 90 = north is to the right). Australia only: the sun is to the NORTH, summer = Dec-Feb.
import type { Metres, Vec2, Vertex } from '@planner-core/types';

export type { Metres, Vec2, Vertex };

export type ClimateZone = 'tropical' | 'subtropical' | 'warm_temperate' | 'cool_temperate' | 'arid' | 'alpine';
export const CLIMATE_ZONES: readonly ClimateZone[] = ['tropical', 'subtropical', 'warm_temperate', 'cool_temperate', 'arid', 'alpine'];
export type Frost = 'none' | 'light' | 'moderate' | 'heavy';
export const FROST_LEVELS: readonly Frost[] = ['none', 'light', 'moderate', 'heavy'];
export type AuState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT';
export const AU_STATES: readonly AuState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
export type Soil = 'sandy' | 'loam' | 'clay';
export type Drainage = 'good' | 'poor';

/**
 * Where the garden is. \`label\` is the short place name ("Paddington QLD", used in titles and file names). \`address\` is the street address when one
 * was entered, and \`precision\` how exactly lat/lng is known: a house on a street, only a street, or only a place (a suburb or a point typed in).
 */
export interface Location { label: string; lat: number; lng: number; state: AuState; postcode?: string; address?: string; precision?: LocationPrecision }
export type LocationPrecision = 'address' | 'street' | 'place';
/** True when the point is as exact as a street or better: the plan can sit on it and the map can be trusted to be near the house. */
export const isLocated = (l: Pick<Location, 'precision'>): boolean => l.precision === 'address' || l.precision === 'street';

/**
 * The satellite map under the plan. (lat, lng) is the point of the earth at plan position (0, 0); the garden's `northDeg` turns the map to
 * match the plan. The location from the wizard is only as exact as a suburb, so the user lines the map up with their plot once ("Move map").
 */
export interface MapSettings { on: boolean; lat: number; lng: number; opacity: number }

/** A closed outline. `smooth` draws a curve through the points (Catmull-Rom); otherwise straight edges. */
export interface Shape { points: Vec2[]; smooth: boolean }

export type FenceType = 'colorbond' | 'timber_paling' | 'brick' | 'hedge' | 'open';
export const FENCE_TYPES: readonly FenceType[] = ['colorbond', 'timber_paling', 'brick', 'hedge', 'open'];
/** Default fence heights in metres. */
export const FENCE_HEIGHT: Record<FenceType, Metres> = { colorbond: 1.8, timber_paling: 1.8, brick: 1.8, hedge: 1.5, open: 0 };

export interface BoundarySegment { fence: FenceType; height: Metres }
/** Plot boundary. `segments[i]` is the edge from `vertices[i]` to `vertices[i + 1]` (wrapping). */
export interface Boundary { vertices: Vertex[]; segments: BoundarySegment[] }

export interface HouseFixture { id: string; type: 'door' | 'window'; edge: number; offset: Metres; width: Metres }
export interface House { id: string; vertices: Vertex[]; height: Metres; fixtures: HouseFixture[] }

export type ZoneKind = 'front' | 'back' | 'side' | 'courtyard' | 'other';
export interface Zone { id: string; name: string; kind: ZoneKind; shape: Shape }

export type EdgingType = 'none' | 'timber' | 'steel' | 'brick' | 'stone';
export type MulchType = 'none' | 'bark' | 'sugarcane' | 'gravel' | 'pebbles';
export interface Bed { id: string; name: string; shape: Shape; edging: EdgingType; mulch: MulchType; raised: boolean }

export type PathMaterial = 'gravel' | 'pavers' | 'concrete' | 'timber' | 'stepping_stones' | 'brick';
/** A path is a centre line with a width, so a path can bend. */
export interface PathItem { id: string; name: string; points: Vec2[]; width: Metres; material: PathMaterial }

export type ServiceKind = 'sewer' | 'water' | 'stormwater' | 'gas' | 'power' | 'easement';
export const SERVICE_KINDS: readonly ServiceKind[] = ['sewer', 'water', 'stormwater', 'gas', 'power', 'easement'];
/**
 * An underground service line or an easement, drawn as a centre line. For an easement `width` is the width of the corridor kept clear of
 * trees and structures; for a pipe it is only how wide to draw it (the clearance for roots comes from the plant's own size).
 */
export interface ServiceLine { id: string; name: string; kind: ServiceKind; points: Vec2[]; width: Metres }

export type GrassType = 'buffalo' | 'kikuyu' | 'couch' | 'zoysia' | 'fescue' | 'synthetic';
export interface Lawn { id: string; name: string; shape: Shape; grass: GrassType }

export type StructureKind =
  | 'pergola' | 'shed' | 'deck' | 'raised_bed' | 'water_tank' | 'clothesline' | 'pool' | 'retaining_wall' | 'trellis' | 'gate';
export interface Structure {
  id: string; kind: StructureKind; name: string;
  position: Vec2; width: Metres; length: Metres; height: Metres; rotation: number;
  /** Gates only: which way the leaf swings (+1 / -1 about the hinge side) and its swing radius is `width`. */
  swing?: 1 | -1;
}

export interface PlantInstance {
  id: string;
  plantId: string;
  position: Vec2;
  note?: string;
}

export interface Underlay {
  name: string;
  /** Reference to the stored picture (`srv-<id>` in the Vault account, `loc-<id>` in this browser). The picture is not part of the design. */
  imageId: string;
  /** Legacy only: gardens saved before pictures were stored separately embedded the picture here. Moved out on load; never written. */
  dataUrl?: string;
  widthPx: number; heightPx: number;
  /** Metres per image pixel, set by marking a known length on the picture. */
  metresPerPixel: number; origin: Vec2; rotation: number; opacity: number;
}

export interface SavedView { id: string; name: string; cameraPosition: [number, number, number]; target: [number, number, number] }

export interface GardenProject {
  schemaVersion: 1;
  id: string;
  name: string;
  location: Location;
  climateZone: ClimateZone;
  frost: Frost;
  /** Pets in the household: switches on the toxic-to-pets check. */
  pets: boolean;
  soil?: Soil;
  drainage?: Drainage;
  /** The way north points on the plan, in degrees clockwise from the top of the plan. 0 = the top of the plan is north. */
  northDeg: number;
  boundary: Boundary | null;
  house: House | null;
  zones: Zone[];
  beds: Bed[];
  paths: PathItem[];
  /** Underground services and easements: optional, so tree checks can keep roots away from them. Older gardens have none. */
  services: ServiceLine[];
  lawns: Lawn[];
  structures: Structure[];
  plants: PlantInstance[];
  underlay?: Underlay;
  /** The satellite map under the plan (optional; absent = never switched on). */
  map?: MapSettings;
  savedViews?: SavedView[];
}

/** Everything that is a list of things with an id. */
export interface Collections {
  zones: Zone; beds: Bed; paths: PathItem; services: ServiceLine; lawns: Lawn; structures: Structure; plants: PlantInstance;
}
export type CollectionName = keyof Collections;
export const COLLECTION_NAMES: readonly CollectionName[] = ['zones', 'beds', 'paths', 'services', 'lawns', 'structures', 'plants'];

/** The settings that live at the top of the project (the wizard's answers). */
export type ProjectMeta = Pick<GardenProject, 'name' | 'location' | 'climateZone' | 'frost' | 'pets' | 'soil' | 'drainage' | 'northDeg'>;
export type SingletonName = 'boundary' | 'house' | 'underlay' | 'map';
