import { sanitizeHTMLToDom } from 'obsidian';
import { normalizeFoundryDescription, stripFoundrySecretSections } from './foundry-description';

/** Render only text and table structure from a Foundry description; source nodes are never mounted. */
export function renderFoundryOverview(container: HTMLElement, html: string | undefined, fallback: string): void {
  if (html === undefined || !/<table\b/i.test(html)) {
    container.createDiv({ text: fallback });
    return;
  }

  const source = sanitizeHTMLToDom(stripFoundrySecretSections(html));
  let rendered = false;
  const text = (element: Element): string => normalizeFoundryDescription(visibleText(element));
  const addText = (value: string, tag: 'p' | 'h5' = 'p'): void => {
    if (!value) return;
    container.createEl(tag, { text: value });
    rendered = true;
  };
  const renderTable = (table: Element): void => {
    const rows = [...table.querySelectorAll('tr')];
    if (rows.length === 0) return;
    const wrapper = container.createDiv({ cls: 'guided-character-sheet__overview-table-scroll' });
    const output = wrapper.createEl('table', { cls: 'guided-character-sheet__overview-table' });
    const caption = [...table.children].find((child) => child.tagName.toLowerCase() === 'caption');
    if (caption) output.createEl('caption', { text: text(caption) });
    for (const row of rows) {
      const cells = [...row.children].filter((child) => child.tagName === 'TH' || child.tagName === 'TD');
      if (cells.length === 0) continue;
      const outputRow = output.createEl('tr');
      const heading = row.parentElement?.tagName === 'THEAD';
      for (const cell of cells) {
        const isHeading = heading || cell.tagName === 'TH';
        const scope = cell.getAttribute('scope');
        outputRow.createEl(isHeading ? 'th' : 'td', { text: text(cell), ...(isHeading ? { attr: { scope: scope === 'row' ? 'row' : 'col' } } : {}) });
      }
    }
    rendered = true;
  };
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { addText(normalizeFoundryDescription(node.textContent ?? '')); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches('.secret, [data-visibility="secret"], script, style, iframe, img, video, audio')) return;
    const tag = element.tagName.toLowerCase();
    if (tag === 'table') { renderTable(element); return; }
    if (/^h[1-6]$/.test(tag)) { addText(text(element), 'h5'); return; }
    if (tag === 'p' || tag === 'li') { addText(text(element)); return; }
    for (const child of [...element.childNodes]) visit(child);
  };
  for (const child of [...source.childNodes]) visit(child);
  if (!rendered) container.createDiv({ text: fallback });
}

function visibleText(element: Element): string {
  let result = '';
  for (const child of [...element.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) result += child.textContent ?? '';
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const nested = child as Element;
      if (nested.matches('.secret, [data-visibility="secret"], script, style, iframe, img, video, audio')) continue;
      const block = /^(BR|P|DIV|LI|H[1-6])$/.test(nested.tagName);
      if (block) result += ' ';
      result += visibleText(nested);
      if (block) result += ' ';
    }
  }
  return result;
}
