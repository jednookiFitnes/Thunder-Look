import { App, Modal } from "obsidian";

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: "J / ↓", desc: "Następna wiadomość na liście" },
  { keys: "K / ↑", desc: "Poprzednia wiadomość na liście" },
  { keys: "C", desc: "Nowa wiadomość (Compose)" },
  { keys: "R", desc: "Odpowiedz nadawcy" },
  { keys: "A", desc: "Odpowiedz wszystkim" },
  { keys: "F", desc: "Przekaż wiadomość dalej" },
  { keys: "E", desc: "Archiwizuj zaznaczone / bieżącą wiadomość" },
  { keys: "Delete / #", desc: "Usuń do Kosza (lub usuń trwale w Koszu/Spamie)" },
  { keys: "S", desc: "Przełącz gwiazdkę (Ważne)" },
  { keys: "U", desc: "Przełącz Przeczytane / Nieprzeczytane" },
  { keys: "/", desc: "Fokus na pasek wyszukiwania (obsługuje from:, has:attachment, is:unread...)" },
  { keys: "Ctrl + Enter", desc: "Wyślij wiadomość (w oknie edytora)" },
  { keys: "Esc", desc: "Odznacz wielokrotne zaznaczenie / wyjdź z wyszukiwania" },
  { keys: "?", desc: "Pokaż / ukryj tę listę skrótów klawiszowych" },
];

export class ShortcutsHelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tl-shortcuts-modal");

    contentEl.createEl("h3", { text: "Skróty klawiszowe — Thunder Look" });
    contentEl.createEl("p", {
      cls: "tl-muted-sm",
      text: "Skróty działają, gdy aktywny jest panel poczty i kursor nie znajduje się w polu tekstowym.",
    });

    const table = contentEl.createEl("table", { cls: "tl-shortcuts-table" });
    const tbody = table.createEl("tbody");
    for (const item of SHORTCUTS) {
      const tr = tbody.createEl("tr");
      const keyTd = tr.createEl("td", { cls: "tl-shortcut-key-cell" });
      keyTd.createEl("kbd", { text: item.keys, cls: "tl-kbd" });
      tr.createEl("td", { text: item.desc });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
