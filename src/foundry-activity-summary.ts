import { isRecord } from './foundry-utils';

export interface FoundryUsesSummary {
  maximum?: string | number;
  recovery: Array<{ period: string; type?: string }>;
}

export interface FoundryDamagePartSummary {
  number?: number;
  denomination?: number;
  bonus?: string;
  types: string[];
  customFormula?: string;
}

export interface FoundryActivitySummary {
  id: string;
  name?: string;
  type: string;
  activation?: { type: string; value?: number };
  range?: { value?: string | number; units?: string; special?: string };
  attack?: { ability?: string; bonus?: string; type?: string; classification?: string };
  damage?: FoundryDamagePartSummary[];
  target?: { affects?: { type?: string }; template?: { type?: string; size?: string | number; width?: string | number; units?: string } };
  save?: { ability?: string[]; dc?: { calculation?: string; formula?: string } };
  consumption: Array<{ type: string; value?: string; target?: string }>;
  uses?: FoundryUsesSummary;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readUses(value: unknown, path?: string, diagnostics?: string[]): FoundryUsesSummary | undefined {
  if (!isRecord(value)) { if (path && diagnostics) diagnostics.push(`${path} must be an object`); return undefined; }
  const recovery = value.recovery === undefined ? [] : Array.isArray(value.recovery) ? value.recovery.flatMap((entry, index) => {
    if (!isRecord(entry)) { diagnostics?.push(`${path}.recovery[${index}] must be an object`); return []; }
    if (typeof entry.period !== 'string') { diagnostics?.push(`${path}.recovery[${index}].period must be a string`); return []; }
    if (entry.type !== undefined && typeof entry.type !== 'string') diagnostics?.push(`${path}.recovery[${index}].type must be a string`);
    return [{ period: entry.period, ...(typeof entry.type === 'string' ? { type: entry.type } : {}) }];
  }) : (diagnostics?.push(`${path}.recovery must be an array`), []);
  const maximum = value.max === undefined || value.max === null || value.max === '' ? undefined : typeof value.max === 'string' || typeof value.max === 'number' ? value.max : (diagnostics?.push(`${path}.max must be a string or number`), undefined);
  if (maximum === undefined && recovery.length === 0) return undefined;
  return { ...(maximum === undefined ? {} : { maximum }), recovery };
}

export function readFoundryActivities(system: Record<string, unknown>): { activities: FoundryActivitySummary[]; diagnostics: string[] } {
  if (system.activities === undefined) return { activities: [], diagnostics: [] };
  if (!isRecord(system.activities)) return { activities: [], diagnostics: ['activities must be an object'] };
  const activities: FoundryActivitySummary[] = [];
  const diagnostics: string[] = [];
  for (const [key, raw] of Object.entries(system.activities)) {
    if (!isRecord(raw)) { diagnostics.push(`activities.${key} must be an object`); continue; }
    const id = text(raw._id) ?? text(raw.id);
    if (id === undefined) { diagnostics.push(`activities.${key} is missing a string id`); continue; }
    const type = text(raw.type);
    if (type === undefined) { diagnostics.push(`activities.${key}.type must be a string`); continue; }
    let activation: FoundryActivitySummary['activation'];
    if (raw.activation !== undefined) {
      if (!isRecord(raw.activation)) diagnostics.push(`activities.${key}.activation must be an object`);
      else {
        if (typeof raw.activation.type !== 'string') diagnostics.push(`activities.${key}.activation.type must be a string`);
        if (raw.activation.value !== undefined && raw.activation.value !== null && typeof raw.activation.value !== 'number') diagnostics.push(`activities.${key}.activation.value must be a number`);
        if (typeof raw.activation.type === 'string') activation = { type: raw.activation.type, ...(typeof raw.activation.value === 'number' ? { value: raw.activation.value } : {}) };
      }
    }
    const rangeRaw = isRecord(raw.range) ? raw.range : undefined;
    let range: FoundryActivitySummary['range'];
    if (raw.range !== undefined) {
      if (!rangeRaw) diagnostics.push(`activities.${key}.range must be an object`);
      else {
        if (rangeRaw.value !== undefined && typeof rangeRaw.value !== 'string' && typeof rangeRaw.value !== 'number') diagnostics.push(`activities.${key}.range.value must be a string or number`);
        if (rangeRaw.units !== undefined && typeof rangeRaw.units !== 'string') diagnostics.push(`activities.${key}.range.units must be a string`);
        if (rangeRaw.special !== undefined && typeof rangeRaw.special !== 'string') diagnostics.push(`activities.${key}.range.special must be a string`);
        if (typeof rangeRaw.value === 'string' || typeof rangeRaw.value === 'number' || typeof rangeRaw.units === 'string' || typeof rangeRaw.special === 'string') range = { ...(typeof rangeRaw.value === 'string' || typeof rangeRaw.value === 'number' ? { value: rangeRaw.value } : {}), ...(typeof rangeRaw.units === 'string' ? { units: rangeRaw.units } : {}), ...(typeof rangeRaw.special === 'string' ? { special: rangeRaw.special } : {}) };
      }
    }
    const attackRaw = isRecord(raw.attack) ? raw.attack : undefined;
    if (raw.attack !== undefined && !attackRaw) diagnostics.push(`activities.${key}.attack must be an object`);
    if (attackRaw?.ability !== undefined && typeof attackRaw.ability !== 'string') diagnostics.push(`activities.${key}.attack.ability must be a string`);
    if (attackRaw?.bonus !== undefined && typeof attackRaw.bonus !== 'string') diagnostics.push(`activities.${key}.attack.bonus must be a string`);
    const attackType = attackRaw?.type === undefined ? undefined : isRecord(attackRaw.type) ? attackRaw.type : (diagnostics.push(`activities.${key}.attack.type must be an object`), undefined);
    if (attackType?.value !== undefined && typeof attackType.value !== 'string') diagnostics.push(`activities.${key}.attack.type.value must be a string`);
    if (attackType?.classification !== undefined && typeof attackType.classification !== 'string') diagnostics.push(`activities.${key}.attack.type.classification must be a string`);
    const attack = attackRaw && (text(attackRaw.ability) || text(attackRaw.bonus) || text(attackType?.value) || text(attackType?.classification))
      ? { ...(text(attackRaw.ability) ? { ability: text(attackRaw.ability) } : {}), ...(text(attackRaw.bonus) ? { bonus: text(attackRaw.bonus) } : {}), ...(text(attackType?.value) ? { type: text(attackType?.value) } : {}), ...(text(attackType?.classification) ? { classification: text(attackType?.classification) } : {}) } : undefined;
    const damageRaw = raw.damage === undefined ? undefined : isRecord(raw.damage) ? raw.damage : (diagnostics.push(`activities.${key}.damage must be an object`), undefined);
    if (damageRaw && damageRaw.parts !== undefined && !Array.isArray(damageRaw.parts)) diagnostics.push(`activities.${key}.damage.parts must be an array`);
    const damage = damageRaw && Array.isArray(damageRaw.parts) ? damageRaw.parts.flatMap((part, index) => {
      if (!isRecord(part)) { diagnostics.push(`activities.${key}.damage.parts[${index}] must be an object`); return []; }
      const custom = isRecord(part.custom) ? part.custom : undefined;
      const customFormula = custom?.enabled === true ? text(custom.formula) : undefined;
      if (custom?.enabled === true && customFormula === undefined) diagnostics.push(`activities.${key}.damage.parts[${index}].custom.formula must be a nonblank string when enabled`);
      if (part.number !== undefined && part.number !== null && typeof part.number !== 'number') diagnostics.push(`activities.${key}.damage.parts[${index}].number must be a number`);
      const denomination = typeof part.denomination === 'number' ? part.denomination : typeof part.denomination === 'string' && /^\d+$/.test(part.denomination) ? Number(part.denomination) : undefined;
      if (part.denomination !== undefined && part.denomination !== null && denomination === undefined) diagnostics.push(`activities.${key}.damage.parts[${index}].denomination must be a number`);
      if (part.bonus !== undefined && typeof part.bonus !== 'string') diagnostics.push(`activities.${key}.damage.parts[${index}].bonus must be a string`);
      if (part.types !== undefined && !Array.isArray(part.types)) diagnostics.push(`activities.${key}.damage.parts[${index}].types must be an array`);
      const types = Array.isArray(part.types) ? part.types.filter((entry): entry is string => typeof entry === 'string') : [];
      if (part.types !== undefined && Array.isArray(part.types) && part.types.some((entry) => typeof entry !== 'string')) diagnostics.push(`activities.${key}.damage.parts[${index}].types entries must be strings`);
      if (typeof part.number !== 'number' && denomination === undefined && typeof part.bonus !== 'string' && types.length === 0 && customFormula === undefined) return [];
      return [{ ...(typeof part.number === 'number' ? { number: part.number } : {}), ...(denomination === undefined ? {} : { denomination }), ...(typeof part.bonus === 'string' ? { bonus: part.bonus } : {}), types, ...(customFormula === undefined ? {} : { customFormula }) }];
    }) : undefined;
    const consumptionRecord = raw.consumption === undefined ? undefined : isRecord(raw.consumption) ? raw.consumption : (diagnostics.push(`activities.${key}.consumption must be an object`), undefined);
    if (consumptionRecord && consumptionRecord.targets !== undefined && !Array.isArray(consumptionRecord.targets)) diagnostics.push(`activities.${key}.consumption.targets must be an array`);
    const consumptionRaw = consumptionRecord && Array.isArray(consumptionRecord.targets) ? consumptionRecord.targets : [];
    const consumption = consumptionRaw.flatMap((entry, index) => {
      if (!isRecord(entry)) { diagnostics.push(`activities.${key}.consumption.targets[${index}] must be an object`); return []; }
      if (typeof entry.type !== 'string') { diagnostics.push(`activities.${key}.consumption.targets[${index}].type must be a string`); return []; }
      if (entry.value !== undefined && typeof entry.value !== 'string') diagnostics.push(`activities.${key}.consumption.targets[${index}].value must be a string`);
      if (entry.target !== undefined && typeof entry.target !== 'string') diagnostics.push(`activities.${key}.consumption.targets[${index}].target must be a string`);
      return [{ type: entry.type, ...(typeof entry.value === 'string' ? { value: entry.value } : {}), ...(typeof entry.target === 'string' && entry.target.length > 0 ? { target: entry.target } : {}) }];
    });
    const uses = raw.uses === undefined ? undefined : readUses(raw.uses, `activities.${key}.uses`, diagnostics);
    const targetRaw = isRecord(raw.target) ? raw.target : undefined;
    const templateRaw = targetRaw && isRecord(targetRaw.template) ? targetRaw.template : undefined;
    const affectsRaw = targetRaw && isRecord(targetRaw.affects) ? targetRaw.affects : undefined;
    const target = templateRaw || affectsRaw ? { ...(affectsRaw && typeof affectsRaw.type === 'string' ? { affects: { type: affectsRaw.type } } : {}), ...(templateRaw ? { template: { ...(typeof templateRaw.type === 'string' ? { type: templateRaw.type } : {}), ...(typeof templateRaw.size === 'string' || typeof templateRaw.size === 'number' ? { size: templateRaw.size } : {}), ...(typeof templateRaw.width === 'string' || typeof templateRaw.width === 'number' ? { width: templateRaw.width } : {}), ...(typeof templateRaw.units === 'string' ? { units: templateRaw.units } : {}) } } : {}) } : undefined;
    const saveRaw = isRecord(raw.save) ? raw.save : undefined;
    const saveAbility = saveRaw === undefined ? undefined : Array.isArray(saveRaw.ability)
      ? saveRaw.ability.filter((value): value is string => typeof value === 'string')
      : typeof saveRaw.ability === 'string' ? [saveRaw.ability] : undefined;
    if (saveRaw?.ability !== undefined && !Array.isArray(saveRaw.ability) && typeof saveRaw.ability !== 'string') diagnostics.push(`activities.${key}.save.ability must be a string or array`);
    const dcRaw = saveRaw && isRecord(saveRaw.dc) ? saveRaw.dc : undefined;
    const save = saveAbility?.length || dcRaw ? { ...(saveAbility && saveAbility.length > 0 ? { ability: saveAbility } : {}), ...(dcRaw ? { dc: { ...(typeof dcRaw.calculation === 'string' ? { calculation: dcRaw.calculation } : {}), ...(typeof dcRaw.formula === 'string' ? { formula: dcRaw.formula } : {}) } } : {}) } : undefined;
    activities.push({ id, ...(text(raw.name) ? { name: text(raw.name) } : {}), type, ...(activation ? { activation } : {}), ...(range ? { range } : {}), ...(attack ? { attack } : {}), ...(target ? { target } : {}), ...(save ? { save } : {}), ...(damage && damage.length > 0 ? { damage } : {}), consumption, ...(uses ? { uses } : {}) });
  }
  return { activities, diagnostics };
}

export function readFoundryUsesDiagnostic(system: Record<string, unknown>): { uses?: FoundryUsesSummary; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const uses = system.uses === undefined ? undefined : readUses(system.uses, 'uses', diagnostics);
  return { ...(uses === undefined ? {} : { uses }), diagnostics };
}

export function readFoundryUses(system: Record<string, unknown>): FoundryUsesSummary | undefined { return readFoundryUsesDiagnostic(system).uses; }
