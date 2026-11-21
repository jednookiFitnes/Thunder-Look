import { App, Modal, Notice, Setting } from "obsidian";
import { ProjectLifecycleService } from "../services/projectLifecycleService";

export class NewProjectModal extends Modal {
  private lifecycle: ProjectLifecycleService;
  private projectCode = "26-";
  private clientName = "";
  private projectTitle = "";
  private projectType: "projekt" | "oferta" = "projekt";

  constructor(app: App, lifecycle: ProjectLifecycleService) {
    super(app);
    this.lifecycle = lifecycle;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Kreator nowego projektu (Thunder Look)" });

    new Setting(contentEl)
      .setName("Numer projektu (YY-XXX)")
      .setDesc("Np. 26-125")
      .addText((t) =>
        t.setValue(this.projectCode).onChange((v) => (this.projectCode = v.trim()))
      );

    new Setting(contentEl)
      .setName("Klient")
      .setDesc("Np. HITACHI, IZOBLOK")
      .addText((t) =>
        t.setPlaceholder("HITACHI").onChange((v) => (this.clientName = v.trim()))
      );

    new Setting(contentEl)
      .setName("Nazwa projektu")
      .setDesc("Np. Test szczelności dużych Kadzi")
      .addText((t) =>
        t
          .setPlaceholder("Nazwa zadania inżynierskiego")
          .onChange((v) => (this.projectTitle = v.trim()))
      );

    new Setting(contentEl)
      .setName("Typ (electrical-project-type)")
      .addDropdown((dd) =>
        dd
          .addOption("projekt", "projekt")
          .addOption("oferta", "oferta")
          .setValue(this.projectType)
          .onChange((v) => (this.projectType = v as "projekt" | "oferta"))
      );

    const footer = contentEl.createDiv({ cls: "tl-modal-footer" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj", type: "button" });
    cancelBtn.addEventListener("click", () => this.close());

    const createBtn = footer.createEl("button", {
      text: "Utwórz projekt",
      type: "button",
      cls: "mod-cta",
    });
    createBtn.addEventListener("click", async () => {
      if (!this.projectCode || !this.clientName || !this.projectTitle) {
        new Notice("Uzupełnij numer projektu, klienta oraz nazwę projektu.");
        return;
      }
      try {
        const masterFile = await this.lifecycle.createProject({
          projectCode: this.projectCode,
          clientName: this.clientName,
          projectTitle: this.projectTitle,
          projectType: this.projectType,
        });
        new Notice(`Utworzono projekt: ${masterFile.parent?.name || masterFile.basename}`);
        await this.app.workspace.getLeaf(false).openFile(masterFile);
        this.close();
      } catch (err) {
        new Notice(`Błąd tworzenia projektu: ${(err as Error).message}`);
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
