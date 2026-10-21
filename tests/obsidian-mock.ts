import { vi } from 'vitest';

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

export function setIcon(_parent: HTMLElement, _iconId: string): void {}

export const setTooltip = vi.fn((_el: HTMLElement, _tooltip: string): void => {});

export function sanitizeHTMLToDom(_html: string): DocumentFragment {
  return { childNodes: [] } as unknown as DocumentFragment;
}

export class TFile {
  path = '';
  extension = 'json';
}

export class TFolder {
  path = '';
  children: unknown[] = [];
}

export class ItemView {
  app = { vault: {} };
  contentEl = {};
  navigation = true;
  constructor(public leaf: unknown) {}
  registerEvent(): void {}
  getState(): Record<string, unknown> { return {}; }
}

export class Modal {
  contentEl = { empty(): void {} };
  titleEl = { setText(_value: string): void {} };
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
}
