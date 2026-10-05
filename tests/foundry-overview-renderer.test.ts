import * as obsidian from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderFoundryOverview } from '../src/foundry-overview-renderer';

type FakeNode = {
  nodeType: number;
  tagName: string;
  textContent: string;
  childNodes: FakeNode[];
  children: FakeNode[];
  parentElement?: FakeNode;
  className?: string;
  createdText?: string;
  matches(selector: string): boolean;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): FakeNode[];
  createEl(tag: string, options?: { text?: string; cls?: string }): FakeNode;
  createDiv(options?: { text?: string; cls?: string }): FakeNode;
};

function element(tagName: string, ...childNodes: FakeNode[]): FakeNode {
  const node: FakeNode = {
    nodeType: 1, tagName: tagName.toUpperCase(), textContent: '', childNodes,
    children: childNodes.filter((child) => child.nodeType === 1),
    matches(selector) { return selector.includes('.secret') && this.className === 'secret'; },
    getAttribute() { return null; },
    querySelectorAll(selector) { return this.childNodes.flatMap((child) => [
      ...(child.tagName.toLowerCase() === selector ? [child] : []), ...child.querySelectorAll(selector),
    ]); },
    createEl(tag, options) { const child = element(tag); child.createdText = options?.text; child.className = options?.cls; this.childNodes.push(child); this.children.push(child); child.parentElement = this; return child; },
    createDiv(options) { return this.createEl('div', options); },
  };
  for (const child of childNodes) child.parentElement = node;
  return node;
}

function textNode(value: string): FakeNode {
  return { ...element('#text'), nodeType: 3, textContent: value };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Foundry overview tables', () => {
  it('preserves prose and table order while omitting secret content and source markup', () => {
    vi.stubGlobal('Node', class { static TEXT_NODE = 3; static ELEMENT_NODE = 1; });
    const secret = element('section', textNode('Hidden GM note'));
    secret.className = 'secret';
    const source = element('fragment',
      element('p', textNode('Hit Dice: d6'), element('br'), textNode('Hit Points: 6')),
      element('table',
        element('caption', textNode('Elven lineages')),
        element('thead', element('tr', element('td', textNode('Lineage')), element('td', textNode('Benefit')))),
        element('tbody', element('tr', element('td', textNode('Drow')), element('td', textNode('@UUID[Compendium.dnd5e.feats.Item.darkvision]{Darkvision}'))))),
      secret,
      element('p', textNode('Continue below.')),
    );
    const sanitize = vi.spyOn(obsidian, 'sanitizeHTMLToDom').mockReturnValue(source as unknown as DocumentFragment);
    const output = element('div');
    renderFoundryOverview(output as unknown as HTMLElement, '<table></table><section class="secret">Hidden<section>nested</section>tail</section><p>Visible.</p>', 'Fallback');
    expect(sanitize).toHaveBeenCalledWith('<table></table><p>Visible.</p>');
    expect(output.children.map((child) => child.tagName)).toEqual(['P', 'DIV', 'P']);
    expect(output.children[0]?.createdText).toBe('Hit Dice: d6 Hit Points: 6');
    expect(output.querySelectorAll('table')).toHaveLength(1);
    expect(output.querySelectorAll('th').map((cell) => cell.createdText)).toEqual(['Lineage', 'Benefit']);
    expect(output.querySelectorAll('td').map((cell) => cell.createdText)).toEqual(['Drow', 'Darkvision']);
    expect(output.children.map((child) => child.createdText)).not.toContain('Hidden GM note');
  });
});
