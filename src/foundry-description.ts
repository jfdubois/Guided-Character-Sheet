const SECTION_TAG = /<\/?section\b[^>]*>/gi;
const SECRET_CLASS = /\bclass\s*=\s*(?:"[^"]*\bsecret\b[^"]*"|'[^']*\bsecret\b[^']*'|[^\s>]*\bsecret\b[^\s>]*)/i;
const REFERENCE = /&Reference\[([^\]]+)](?:\{([^}]*)})?/gi;

export function stripFoundrySecretSections(value: string): string {
  let visible = '';
  let cursor = 0;
  let hiddenDepth = 0;
  const sections: boolean[] = [];
  for (const match of value.matchAll(SECTION_TAG)) {
    const tag = match[0];
    const position = match.index;
    if (hiddenDepth === 0) visible += value.slice(cursor, position);
    if (/^<\/section/i.test(tag)) {
      const wasHidden = hiddenDepth > 0;
      if (sections.pop()) hiddenDepth--;
      if (!wasHidden) visible += tag;
    } else {
      const secret = SECRET_CLASS.test(tag);
      if (hiddenDepth === 0 && !secret) visible += tag;
      sections.push(secret);
      if (secret) hiddenDepth++;
    }
    cursor = position + tag.length;
  }
  if (hiddenDepth === 0) visible += value.slice(cursor);
  return visible;
}

/** Convert Foundry-authored rich text into safe, character-facing plain text. */
export function normalizeFoundryDescription(value: string): string {
  return decodeHtmlEntities(stripFoundrySecretSections(value))
    .replace(REFERENCE, (_match, config: string, label: string | undefined) => referenceLabel(config, label))
    .replace(/@Embed\[[^\]]*\]/g, '')
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function referenceLabel(config: string, explicitLabel: string | undefined): string {
  if (explicitLabel?.trim()) return explicitLabel.trim();
  const values = config.trim().split(/\s+/).filter((part) => !/^apply(?:=|$)/i.test(part));
  const first = values[0] ?? '';
  if (first.includes('=')) values[0] = first.slice(first.indexOf('=') + 1);
  const identifier = values.join(' ').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const readable = identifier.toLocaleLowerCase() === 'unarmedstrike' ? 'unarmed strike' : identifier;
  return readable.replace(/^./, (letter) => letter.toLocaleUpperCase());
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
    if (decimal !== undefined || hexadecimal !== undefined) {
      const encoded = decimal ?? hexadecimal;
      if (encoded === undefined) return match;
      const point = Number.parseInt(encoded, decimal === undefined ? 16 : 10);
      return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return name === undefined ? match : named[name.toLocaleLowerCase()] ?? match;
  });
}
