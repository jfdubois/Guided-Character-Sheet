import type { FoundrySourceReference } from './foundry-source-catalog';

export type EquipmentNodeType = 'AND' | 'OR' | 'linked' | 'currency' | 'weapon' | 'armor' | 'tool' | 'focus' | string;

export interface EquipmentSemanticGrant { category: 'weapon' | 'armor' | 'tool' | 'focus'; selector: string; }
export interface EquipmentCurrencyGrant { denomination: string; amount: number; }

export interface EquipmentPackageNode {
  nodeId: string;
  type: EquipmentNodeType;
  children?: EquipmentPackageNode[];
  item?: FoundrySourceReference;
  quantity?: number;
  currency?: EquipmentCurrencyGrant;
  semantic?: EquipmentSemanticGrant;
  key?: string;
  group?: string;
  requiresProficiency?: boolean;
  diagnostics: string[];
}

export interface EquipmentPackageSummary { roots: EquipmentPackageNode[]; diagnostics: string[]; }
export type EquipmentSourceResolver = (key: string) => Promise<FoundrySourceReference | null>;

export async function normalizeStartingEquipment(entries: unknown[], resolve?: EquipmentSourceResolver): Promise<EquipmentPackageSummary> {
  const sourceNodes = entries.flatMap((entry, index) => isRecord(entry) && typeof entry._id === 'string' && typeof entry.type === 'string' ? [{ entry, index, nodeId: entry._id, type: entry.type as EquipmentNodeType, group: typeof entry.group === 'string' ? entry.group : '', sort: typeof entry.sort === 'number' ? entry.sort : index }] : []);
  const nodes = new Map(sourceNodes.map(({ nodeId, type, group, sort }) => [nodeId, { nodeId, type, group, sort }]));
  const diagnostics: string[] = [];
  const build = async (nodeId: string): Promise<EquipmentPackageNode> => {
    const source = sourceNodes.find((candidate) => candidate.nodeId === nodeId);
    if (source === undefined) return { nodeId, type: 'unknown', diagnostics: [`Missing equipment package node: ${nodeId}`] };
    const { entry, type, group } = source;
    const children = sourceNodes.filter((candidate) => candidate.group === nodeId).sort((left, right) => left.sort - right.sort || left.index - right.index);
    const base = { nodeId, type, ...(group.length > 0 ? { group } : {}), ...(typeof entry.requiresProficiency === 'boolean' ? { requiresProficiency: entry.requiresProficiency } : {}), diagnostics: [] as string[] };
    if (type === 'AND' || type === 'OR') return { ...base, children: await Promise.all(children.map((child) => build(child.nodeId))) };
    const key = typeof entry.key === 'string' ? entry.key : undefined;
    const quantity = typeof entry.count === 'number' && Number.isFinite(entry.count) ? entry.count : 1;
    if (type === 'linked') {
      if (key === undefined) return { ...base, diagnostics: ['Equipment link has no source key'] };
      if (resolve === undefined) return { ...base, key, quantity };
      const item = await resolve(key);
      return item === null ? { ...base, key, quantity, diagnostics: [`Unresolved equipment source: ${key}`] } : { ...base, key, quantity, item };
    }
    if (type === 'currency') return { ...base, ...(key === undefined ? {} : { key }), currency: { denomination: key ?? 'gp', amount: quantity } };
    if (type === 'weapon' || type === 'armor' || type === 'tool' || type === 'focus') return { ...base, ...(key === undefined ? {} : { key }), quantity, ...(key === undefined ? {} : { semantic: { category: type, selector: key } }) };
    if (type !== 'AND' && type !== 'OR') return { ...base, ...(key === undefined ? {} : { key }), ...(quantity === 1 ? {} : { quantity }), diagnostics: [`Unsupported equipment node type: ${type}`] };
    return base;
  };
  const roots = sourceNodes.filter((candidate) => candidate.group.length === 0).sort((left, right) => left.sort - right.sort || left.index - right.index).map((candidate) => candidate.nodeId);
  const built = await Promise.all(roots.map(build));
  for (const source of sourceNodes) if (source.group.length > 0 && !nodes.has(source.group)) diagnostics.push(`Equipment node ${source.nodeId} references missing group ${source.group}`);
  return { roots: built, diagnostics };
}

/** Projects Foundry's detached 2024 starting wealth into the same choice tree as package A. */
export async function projectStartingEquipment(entries: unknown[], wealth?: string, resolve?: EquipmentSourceResolver): Promise<EquipmentPackageSummary> {
  const summary = await normalizeStartingEquipment(entries, resolve);
  if (wealth === undefined) return summary;
  const trimmedWealth = wealth.trim();
  const amount = Number(trimmedWealth);
  if (!/^[1-9]\d*$/.test(trimmedWealth) || !Number.isSafeInteger(amount)) {
    return { ...summary, diagnostics: [...summary.diagnostics, `Invalid starting wealth: ${wealth}`] };
  }
  const packageRoot = summary.roots.length === 1
    ? summary.roots[0]
    : { nodeId: 'synthetic:starting-equipment-package', type: 'AND' as const, children: summary.roots, diagnostics: [] };
  const wealthNode: EquipmentPackageNode = {
    nodeId: 'synthetic:starting-equipment-wealth', type: 'AND', diagnostics: [],
    children: [{ nodeId: `synthetic:starting-equipment-wealth-gp-${amount}`, type: 'currency', key: 'gp', currency: { denomination: 'gp', amount }, diagnostics: [] }],
  };
  return { roots: [{ nodeId: 'synthetic:starting-equipment-choice', type: 'OR', children: [packageRoot, wealthNode], diagnostics: [] }], diagnostics: [...summary.diagnostics] };
}

export async function resolveStartingEquipmentItems(summary: EquipmentPackageSummary, resolve: EquipmentSourceResolver): Promise<EquipmentPackageSummary> {
  const resolveNode = async (node: EquipmentPackageNode): Promise<EquipmentPackageNode> => {
    const children = node.children === undefined ? undefined : await Promise.all(node.children.map(resolveNode));
    if (node.type !== 'linked' || node.item !== undefined || node.key === undefined) return { ...node, ...(children === undefined ? {} : { children }) };
    const item = await resolve(node.key);
    return item === null ? { ...node, ...(children === undefined ? {} : { children }), diagnostics: [...node.diagnostics, `Unresolved equipment source: ${node.key}`] } : { ...node, ...(children === undefined ? {} : { children }), item };
  };
  return { roots: await Promise.all(summary.roots.map(resolveNode)), diagnostics: [...summary.diagnostics] };
}

export function getEquipmentChoiceLabel(node: EquipmentPackageNode): string {
  const categories = new Set<string>();
  const visit = (candidate: EquipmentPackageNode): void => { if (candidate.semantic) categories.add(candidate.semantic.category); for (const child of candidate.children ?? []) visit(child); };
  visit(node);
  if (categories.size === 1) return `Choose a ${[...categories][0]}`;
  return 'Choose an equipment package';
}

export function getEquipmentOptionContents(node: EquipmentPackageNode): string[] {
  if (node.type === 'AND') return (node.children ?? []).flatMap(getEquipmentOptionContents);
  if (node.type === 'OR') return [(node.children ?? []).map((child) => getEquipmentOptionContents(child).join(', ')).filter(Boolean).join(' or ') || 'Choose an option'];
  if (node.type === 'linked') return [node.item?.name ?? `Item ${node.key?.split('.').at(-1) ?? 'source'}`];
  if (node.type === 'currency') return [node.currency ? `${node.currency.amount} ${node.currency.denomination.toUpperCase()}` : 'Currency'];
  if (node.semantic) return [`Choose a ${node.semantic.category}`];
  return [node.type];
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
