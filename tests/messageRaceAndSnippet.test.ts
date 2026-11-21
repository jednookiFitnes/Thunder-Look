import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PriorityTaskQueue, TaskTimeoutError } from "../shared/taskQueue.js";
import { extractCleanSnippet } from "../shared/textUtils.js";
import { buildFolderTree, type FolderDescriptor } from "../shared/folderMapper.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Rapid Message Switching Race-Condition & PriorityTaskQueue", () => {
  it("przy szybkim kliknięciu 5 wiadomości (gdzie #1 odpowiada wolniej niż #5) ZAWSZE wygrywa #5", async () => {
    let messageLoadSeq = 0;
    let activeAbort: AbortController | null = null;
    let displayedUid: number | null = null;
    const staleWrites: number[] = [];

    const delaysByUid: Record<number, number> = {
      101: 90, // najwolniejsza (pierwsze kliknięcie)
      102: 70,
      103: 60,
      104: 45,
      105: 15, // najszybsza (ostatnie kliknięcie)
    };

    const simulateOpenMessage = async (uid: number): Promise<void> => {
      const seq = ++messageLoadSeq;
      activeAbort?.abort();
      const ctrl = new AbortController();
      activeAbort = ctrl;
      displayedUid = null; // 0 ms wyczyszczenie poprzedniego maila

      await sleep(delaysByUid[uid]);
      if (ctrl.signal.aborted || seq !== messageLoadSeq) {
        return;
      }
      if (displayedUid !== null) {
        staleWrites.push(uid);
      }
      displayedUid = uid;
    };

    const clicks = [101, 102, 103, 104, 105].map((uid) => simulateOpenMessage(uid));
    await Promise.all(clicks);

    assert.equal(displayedUid, 105, "Ostatnie kliknięcie (#5 / UID 105) musi być jedynym aktywnym podglądem");
    assert.equal(staleWrites.length, 0, "Żadna przeterminowana odpowiedź nie może nadpisać podglądu");
  });

  it("PriorityTaskQueue: zadania high wyprzedzają low (prefetch), a cancelPendingByTag anuluje prefetch natychmiast", async () => {
    const queue = new PriorityTaskQueue();
    const order: string[] = [];

    // Zablokuj kolejkę krótkim aktywnym zadaniem
    const blocker = queue.enqueue(async () => {
      await sleep(30);
      order.push("blocker");
    });

    const prefetch1 = queue.enqueue(
      async () => {
        order.push("prefetch-1");
      },
      { priority: "low", tag: "prefetch" }
    );

    const prefetch2 = queue.enqueue(
      async () => {
        order.push("prefetch-2");
      },
      { priority: "low", tag: "prefetch" }
    );

    const normalTask = queue.enqueue(
      async () => {
        order.push("normal");
      },
      { priority: "normal" }
    );

    const highClick = queue.enqueue(
      async () => {
        order.push("high-click");
        return "OK";
      },
      { priority: "high" }
    );

    // Anuluj oczekujące prefetchy tak jak robi to ImapService przy kliknięciu
    const cancelled = queue.cancelPendingByTag("prefetch");
    assert.equal(cancelled, 2);

    await assert.rejects(prefetch1, /ABORTED/);
    await assert.rejects(prefetch2, /ABORTED/);

    const highResult = await highClick;
    await Promise.all([blocker, normalTask]);

    assert.equal(highResult, "OK");
    assert.deepEqual(order, ["blocker", "high-click", "normal"]);
  });

  it("PriorityTaskQueue: twardy timeout zwalnia blokadę kolejki bez zakleszczenia (deadlock)", async () => {
    const queue = new PriorityTaskQueue();

    const stalled = queue.enqueue(
      () => new Promise<string>(() => {
        // celowo zawieszone gniazdo — nigdy nie rozwiązuje Promise
      }),
      { priority: "normal", timeoutMs: 40 }
    );

    const nextAfterTimeout = queue.enqueue(async () => "recovered", {
      priority: "high",
      timeoutMs: 200,
    });

    await assert.rejects(stalled, (err: unknown) => err instanceof TaskTimeoutError);
    assert.equal(await nextAfterTimeout, "recovered");
  });
});

describe("extractCleanSnippet — czysty podgląd 1-liniowy na liście", () => {
  it("usuwa artefakty blokady obrazków, <style>, <script>, encje HTML, znaki zerowej szerokości i linki", () => {
    const dirty = `
      <style>.x { color: red; }</style>
      <script>alert(1)</script>
      <!-- hidden -->
      \\ [Zablokowany obraz zdalny] \\
      \\[Zablokowany obraz zdalny\\]
      &nbsp;&zwnj;\u200B\uFEFF
      Dzień dobry &amp; zapraszamy na spotkanie projektowe https://example.com/very/long/url?token=abc
      > Cytowana linia z poprzedniej odpowiedzi
    `;

    const clean = extractCleanSnippet(dirty, 110);
    assert.ok(!clean.includes("Zablokowany obraz zdalny"));
    assert.ok(!clean.includes("color: red"));
    assert.ok(!clean.includes("alert(1)"));
    assert.ok(!clean.includes("&nbsp;"));
    assert.ok(!clean.includes("&zwnj;"));
    assert.ok(!clean.includes("https://"));
    assert.ok(!clean.includes("\u200B"));
    assert.ok(clean.includes("Dzień dobry & zapraszamy na spotkanie projektowe"));
  });

  it("zwraca pusty ciąg dla pustych lub wyłącznie zaśmieconych treści (bez fallbacku do rozmiaru pliku)", () => {
    assert.equal(extractCleanSnippet(""), "");
    assert.equal(
      extractCleanSnippet("\\[Zablokowany obraz zdalny\\] &nbsp;&zwnj;\u200B <style>a{}</style>"),
      ""
    );
  });
});

describe("buildFolderTree — deduplikacja folderów systemowych Gmaila", () => {
  it("eliminuje podwójne „Szkice” ([Gmail]/Wersje robocze + legacy Wersje robocze) i przenosi duplikat do FOLDERY", () => {
    const gmailFolders: FolderDescriptor[] = [
      { path: "INBOX", specialUse: "\\Inbox", messages: 120, unseen: 5, uidValidity: "1" },
      { path: "INBOX", messages: 120, unseen: 5, uidValidity: "1" }, // dokładny duplikat
      {
        path: "[Gmail]/Wersje robocze",
        specialUse: "\\Drafts",
        messages: 4,
        unseen: 0,
        uidValidity: "2",
      },
      {
        path: "Wersje robocze",
        messages: 1,
        unseen: 0,
        uidValidity: "3",
      },
      {
        path: "[Gmail]/Wysłane",
        specialUse: "\\Sent",
        messages: 80,
        unseen: 0,
        uidValidity: "4",
      },
      {
        path: "Projekty/2026",
        delimiter: "/",
        messages: 12,
        unseen: 2,
        uidValidity: "5",
      },
    ];

    const tree = buildFolderTree(gmailFolders);

    const inboxNodes = tree.systemNodes.filter((n) => n.role === "inbox");
    const draftNodes = tree.systemNodes.filter((n) => n.role === "drafts");
    assert.equal(inboxNodes.length, 1, "Musi istnieć dokładnie 1 folder Odebrane");
    assert.equal(draftNodes.length, 1, "Musi istnieć dokładnie 1 folder Szkice w sekcji systemowej");
    assert.equal(
      draftNodes[0].fullPath,
      "[Gmail]/Wersje robocze",
      "Kanonicznym folderem Szkice musi być [Gmail]/Wersje robocze z flagą \\Drafts"
    );

    const legacyDraft = tree.customNodes.find((n) => n.fullPath === "Wersje robocze");
    assert.ok(
      legacyDraft,
      "Drugi folder o podobnej nazwie (Wersje robocze) powinien trafić do sekcji customNodes pod oryginalną nazwą"
    );
    assert.equal(legacyDraft?.name, "Wersje robocze");
  });
});
