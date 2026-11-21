import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';

function createMockElement(tag = 'div', text = '') {
  const children: ReturnType<typeof createMockElement>[] = [];
  const classes = new Set<string>();
  const el = {
    tagName: tag.toUpperCase(),
    textContent: text,
    value: '',
    placeholder: '',
    type: '',
    rows: 1,
    disabled: false,
    className: '',
    style: {} as Record<string, string>,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    children,
    empty() {
      children.length = 0;
      el.textContent = '';
    },
    setText(next: string) {
      el.textContent = next;
    },
    createDiv(opts?: { cls?: string; text?: string }) {
      const child = createMockElement('div', opts?.text || '');
      children.push(child);
      return child;
    },
    createSpan(opts?: { cls?: string; text?: string }) {
      const child = createMockElement('span', opts?.text || '');
      children.push(child);
      return child;
    },
    createEl(childTag: string, opts?: { cls?: string; text?: string; type?: string }) {
      const child = createMockElement(childTag, opts?.text || '');
      children.push(child);
      return child;
    },
    addEventListener() {},
    addClass(c: string) { classes.add(c); },
    removeClass(c: string) { classes.delete(c); },
    toggleClass(c: string, val: boolean) { if (val) classes.add(c); else classes.delete(c); },
    setAttr() {},
    remove() {},
  };
  return el;
}

/**
 * Test regresyjny ładowania produkcyjnego bundla obsidian-plugin/main.js
 * w środowisku symulującym CommonJS loader Obsidiana (Electron Desktop):
 * 1. Wykrywa błędy ładowania modułów (np. `Class extends value undefined`).
 * 2. Weryfikuje, że otwarcie karty ustawień po zapisaniu hasła NIE wpada
 *    w nieskończoną pętlę renderowania (brak zawieszania Obsidiana).
 */
describe('Obsidian plugin production bundle runtime load', () => {
  it('ładuje obsidian-plugin/main.js, uruchamia onload(), otwiera ustawienia z zapisanym hasłem bez pętli renderowania i kończy onunload()', async () => {
    const bundlePath = path.resolve(process.cwd(), 'obsidian-plugin', 'main.js');
    assert.equal(fs.existsSync(bundlePath), true, 'Brak skompilowanego pliku obsidian-plugin/main.js');

    let registeredSettingTab: {
      containerEl: ReturnType<typeof createMockElement>;
      display: () => void;
      hide?: () => void;
    } | null = null;

    class MockPlugin {
      app: unknown;
      manifest: unknown;
      constructor(app: unknown, manifest: unknown) {
        this.app = app;
        this.manifest = manifest;
      }
      async loadData() {
        return {};
      }
      async saveData() {}
      registerView() {}
      registerExtensions() {}
      registerMarkdownCodeBlockProcessor() {}
      addRibbonIcon() {
        return { addClass() {} };
      }
      addCommand() {}
      addSettingTab(tab: typeof registeredSettingTab) {
        registeredSettingTab = tab;
      }
      registerEvent() {}
      registerInterval(id: number) {
        return id;
      }
      registerDomEvent() {}
      addStatusBarItem() {
        return createMockElement('span');
      }
    }

    class MockBase {
      app: unknown;
      containerEl: ReturnType<typeof createMockElement>;
      constructor(app?: unknown) {
        this.app = app;
        this.containerEl = createMockElement('div');
      }
    }

    const mockSettingFactory = () => {
      const s = {
        descEl: createMockElement('div'),
        setName() { return s; },
        setDesc() { return s; },
        setHeading() { return s; },
        addText(cb?: (t: unknown) => void) {
          const inputEl = createMockElement('input');
          const comp = {
            inputEl,
            setPlaceholder() { return comp; },
            setValue(v: string) { inputEl.value = v; return comp; },
            onChange() { return comp; },
          };
          cb?.(comp);
          return s;
        },
        addTextArea(cb?: (ta: unknown) => void) {
          const inputEl = createMockElement('textarea');
          const comp = {
            inputEl,
            setPlaceholder() { return comp; },
            setValue(v: string) { inputEl.value = v; return comp; },
            onChange() { return comp; },
          };
          cb?.(comp);
          return s;
        },
        addToggle(cb?: (t: unknown) => void) {
          const comp = {
            setValue() { return comp; },
            onChange() { return comp; },
          };
          cb?.(comp);
          return s;
        },
        addDropdown(cb?: (dd: unknown) => void) {
          const comp = {
            addOption() { return comp; },
            setValue() { return comp; },
            onChange() { return comp; },
          };
          cb?.(comp);
          return s;
        },
        addButton(cb?: (b: unknown) => void) {
          const comp = {
            setButtonText() { return comp; },
            setCta() { return comp; },
            setDisabled() { return comp; },
            onClick() { return comp; },
          };
          cb?.(comp);
          return s;
        },
      };
      return s;
    };

    const mockObsidian = {
      Plugin: MockPlugin,
      PluginSettingTab: class extends MockBase {},
      ItemView: class extends MockBase {},
      FileView: class extends MockBase {},
      EditableFileView: class extends MockBase {},
      Modal: class extends MockBase {},
      SuggestModal: class extends MockBase {
        setPlaceholder() {}
      },
      FuzzySuggestModal: class extends MockBase {
        setPlaceholder() {}
      },
      MarkdownRenderChild: class extends MockBase {},
      Setting: function MockSetting() {
        return mockSettingFactory();
      },
      Notice: class {},
      TFile: class {},
      TFolder: class {},
      normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      setIcon: () => {},
      Menu: class {
        addItem() { return this; }
        showAtMouseEvent() {}
      },
    };

    const mockElectron = {
      shell: { openExternal: async () => {} },
    };

    const cjsRequire = createRequire(import.meta.url);
    const modAny = Module as unknown as {
      _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = modAny._load;

    modAny._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'obsidian') return mockObsidian;
      if (request === 'electron') return mockElectron;
      return originalLoad.call(this, request, parent, isMain);
    };

    const createdIntervals: ReturnType<typeof setInterval>[] = [];
    const hadWindow = 'window' in globalThis;
    const prevWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      setInterval: (fn: () => void, ms: number) => {
        const id = setInterval(fn, ms);
        createdIntervals.push(id);
        return id;
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    };

    try {
      delete cjsRequire.cache[bundlePath];
      const loaded = cjsRequire(bundlePath) as { default?: new (...args: unknown[]) => unknown } | (new (...args: unknown[]) => unknown);
      const PluginCtor =
        typeof loaded === 'function' ? loaded : loaded?.default;

      assert.equal(typeof PluginCtor, 'function', 'Eksport domyślny main.js musi być konstruktorem wtyczki');

      const localStore = new Map<string, unknown>();
      const mockApp = {
        loadLocalStorage: (k: string) => localStore.get(k) ?? null,
        saveLocalStorage: (k: string, v: unknown) => {
          if (v === null) localStore.delete(k);
          else localStore.set(k, v);
        },
        vault: {
          on: () => ({}),
          getAbstractFileByPath: () => null,
          getMarkdownFiles: () => [],
          getAllLoadedFiles: () => [],
          adapter: {
            exists: async () => false,
            read: async () => '',
            write: async () => {},
            mkdir: async () => {},
          },
        },
        workspace: {
          on: () => ({}),
          onLayoutReady: (cb: () => void) => cb(),
          getLeavesOfType: () => [],
          getRightLeaf: () => null,
          getLeaf: () => ({ setViewState: async () => {} }),
          revealLeaf: () => {},
        },
        metadataCache: {
          on: () => ({}),
          getFileCache: () => null,
        },
        fileManager: {
          processFrontMatter: async () => {},
        },
      };

      const manifest = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'obsidian-plugin', 'manifest.json'), 'utf8')
      );

      const instance = new (PluginCtor as new (app: unknown, manifest: unknown) => {
        onload: () => Promise<void>;
        onunload: () => void;
        secretService: { setMailPassword: (p: string) => Promise<void>; getMailPassword: () => Promise<string> };
      })(mockApp, manifest);
      assert.equal(instance instanceof MockPlugin, true, 'Instancja musi dziedziczyć po obsidian.Plugin');

      await instance.onload();

      // Zapisz hasło i otwórz kartę ustawień — weryfikacja braku nieskończonej pętli display()
      await instance.secretService.setMailPassword('abcd efgh ijkl mnop');
      const storedPwd = await instance.secretService.getMailPassword();
      assert.equal(storedPwd, 'abcd efgh ijkl mnop');
      assert.ok(registeredSettingTab, 'Wtyczka powinna zarejestrować kartę ustawień');

      let displayCalls = 0;
      const origDisplay = registeredSettingTab.display.bind(registeredSettingTab);
      registeredSettingTab.display = () => {
        displayCalls += 1;
        assert.ok(displayCalls <= 2, `Wykryto nieskończoną pętlę renderowania ustawień (wywołania: ${displayCalls})`);
        origDisplay();
      };

      registeredSettingTab.display();
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(displayCalls, 1, 'Otwarcie ustawień z zapisanym hasłem nie może wywoływać ponownego display() w pętli');
      registeredSettingTab.hide?.();

      // Weryfikacja odchudzonego rozmiaru bundla (< 1.5 MB po deduplikacji iconv-lite/libmime)
      const stat = fs.statSync(bundlePath);
      assert.ok(
        stat.size < 1_500_000,
        `Rozmiar obsidian-plugin/main.js powinien być zoptymalizowany (<1.5 MB), otrzymano ${(stat.size / 1024 / 1024).toFixed(2)} MB`
      );

      // Weryfikacja, że zdeduplikowany iconv-lite + mailparser poprawnie dekoduje polskie znaki (UTF-8 i Windows-1250)
      const instWithParser = instance as unknown as {
        mailParser?: {
          parseRawMessage: (raw: Buffer | string, meta: { uid: number; folder: string; flags?: string[] }) => Promise<{ subject: string; textBody: string }>;
        };
      };
      if (instWithParser.mailParser) {
        const rawUtf8 = [
          'From: Jan Kowalski <jan@trinitec.pl>',
          'To: Piotr <piotr@trinitec.pl>',
          'Subject: =?UTF-8?B?WsWCxIVjem5payDFm8OzxYIg4oCTIHByw7NiYQ==?=',
          'Content-Type: text/plain; charset="utf-8"',
          '',
          'Zażółć gęślą jaźń — ĄĆĘŁŃÓŚŹŻ',
        ].join('\r\n');
        const parsedUtf8 = await instWithParser.mailParser.parseRawMessage(Buffer.from(rawUtf8, 'utf8'), {
          uid: 1,
          folder: 'INBOX',
        });
        assert.ok(parsedUtf8.textBody.includes('Zażółć gęślą jaźń'), 'Dekodowanie polskich znaków UTF-8 musi działać w bundlu');
      }

      instance.onunload();
    } finally {
      for (const id of createdIntervals) clearInterval(id);
      if (hadWindow) {
        (globalThis as Record<string, unknown>).window = prevWindow;
      } else {
        delete (globalThis as Record<string, unknown>).window;
      }
      modAny._load = originalLoad;
      delete cjsRequire.cache[bundlePath];
    }
  });
});

