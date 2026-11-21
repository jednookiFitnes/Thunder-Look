import { App } from "obsidian";
import { naturalCompare } from "./textUtils";

const MRU_STORAGE_PREFIX = "trinitec-mail-mru-v1:";

/**
 * Magazyn MRU (Most Recently Used) zgodnie z AGENTS.md:
 * sortuje wybory projektów, notatek, kategorii i kontaktów według ostatniego użycia,
 * a pozostałe pozycje alfanumerycznie (natural sorting).
 */
export class MruStore {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private getKey(bucket: string): string {
    return `${MRU_STORAGE_PREFIX}${bucket}`;
  }

  getOrder(bucket: string): string[] {
    try {
      const raw = this.app.loadLocalStorage(this.getKey(bucket));
      if (Array.isArray(raw)) {
        return raw.map((x) => String(x));
      }
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
      }
    } catch {
      // ignore corrupted localStorage entry
    }
    return [];
  }

  recordUse(bucket: string, itemId: string, maxEntries = 50): void {
    if (!itemId) return;
    const prev = this.getOrder(bucket).filter((id) => id !== itemId);
    const next = [itemId, ...prev].slice(0, maxEntries);
    try {
      this.app.saveLocalStorage(this.getKey(bucket), JSON.stringify(next));
    } catch {
      // ignore storage quota limits
    }
  }

  sortByMru<T>(
    bucket: string,
    items: T[],
    getId: (item: T) => string,
    getLabel: (item: T) => string
  ): T[] {
    const order = this.getOrder(bucket);
    const rankMap = new Map<string, number>();
    order.forEach((id, idx) => rankMap.set(id, idx));

    return [...items].sort((a, b) => {
      const rankA = rankMap.get(getId(a));
      const rankB = rankMap.get(getId(b));
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return naturalCompare(getLabel(a), getLabel(b));
    });
  }
}
