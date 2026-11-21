import {
  MockContact,
  MockProject,
  SampleEmail,
  SimulatorConfig,
  StorageFolderMetric,
  StorageMessageMetric,
} from '../types/generator';

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  activeProjectsDir: '11 - Notes - Trinitec Projekty',
  archiveProjectsDir: '12 - Notes - Trinitec Archiwum',
  contactsDir: '11 - Notes - Trinitec Projekty/kontakty',
  globalAssetsDir: '_Assets',
  projectCodeRegex: '\\b\\d{2}-\\d{3}\\b',
  imapHost: 'imap.roundcube.pl',
  inboxFolder: 'INBOX',
  quotaWarnPercent: 80,
  defaultSaveMode: 'new-file',
  attachmentsTarget: 'project-attachments',
  fileNamePattern: 'Mail - {YYYY-MM-DD} - {Subject}.md',
  defaultElectricalTopic: 'Korespondencja',
  autoDetectTasks: true,
  aiCategories: [
    {
      id: 'cat-zlecenie',
      label: 'Zlecenie',
      imapFolder: 'INBOX/Zlecenia',
      vaultTopic: 'Zamówienia',
      keywords: 'zamówienie, zlecenie, PO, uruchomienie, realizacja, harmonogram',
    },
    {
      id: 'cat-pytanie',
      label: 'Pytanie',
      imapFolder: 'INBOX/Pytania',
      vaultTopic: 'Korespondencja',
      keywords: 'pytanie, prośba o wyjaśnienie, czy możemy, wątpliwość, konsultacja',
    },
    {
      id: 'cat-raport',
      label: 'Raport',
      imapFolder: 'INBOX/Raporty',
      vaultTopic: 'Pomiary',
      keywords: 'raport, protokół, pomiary, test szczelności, FAT, SAT, wyniki',
    },
    {
      id: 'cat-oferta',
      label: 'Oferta',
      imapFolder: 'INBOX/Oferty',
      vaultTopic: 'Zamówienia',
      keywords: 'wycena, oferta, RFQ, zapytanie ofertowe, kosztorys, BOM',
    },
  ],
};

export const EXISTING_VAULT_MESSAGE_IDS: Record<string, string> = {
  '<hitachi-rev-c-20261120@mail.hitachi.com>':
    '11 - Notes - Trinitec Projekty/26-125 - HITACHI - Test szczelności dużych Kadzi/Mail - 2026-11-20 - Re- [26-125] Schematy szafy AKPiA.md',
};

export const MOCK_PROJECTS: MockProject[] = [
  {
    code: '26-125',
    client: 'HITACHI',
    title: 'Test szczelności dużych Kadzi',
    folderName: '26-125 - HITACHI - Test szczelności dużych Kadzi',
    masterNote: '_26-125 - HITACHI - Test szczelności dużych Kadzi',
    existingNotes: [
      '_26-125 - HITACHI - Test szczelności dużych Kadzi.md',
      'Spotkanie - 2026-11-12 - Ustalenia AKPiA.md',
      'Mails - 11.2026.md',
    ],
  },
  {
    code: '26-070',
    client: 'IZOBLOK',
    title: 'Zgrzewanie Ultrasonic',
    folderName: '26-070 - IZOBLOK - Zgrzewanie Ultrasonic',
    masterNote: '_26-070 - IZOBLOK - Zgrzewanie Ultrasonic',
    existingNotes: [
      '_26-070 - IZOBLOK - Zgrzewanie Ultrasonic.md',
      'Zamówienia/BOM - Szafa Sterownicza.md',
      'Mails - 11.2026.md',
    ],
  },
  {
    code: '26-142',
    client: 'BREMBO',
    title: 'Modernizacja linii odlewniczej PLC',
    folderName: '26-142 - BREMBO - Modernizacja linii odlewniczej PLC',
    masterNote: '_26-142 - BREMBO - Modernizacja linii odlewniczej PLC',
    existingNotes: [
      '_26-142 - BREMBO - Modernizacja linii odlewniczej PLC.md',
      'Notatka - Audyt bezpieczeństwa.md',
    ],
  },
];

export const MOCK_CONTACTS: MockContact[] = [
  {
    name: 'Jan Kowalski',
    email: 'jan.kowalski@hitachi.com',
    client: 'Hitachi',
    role: 'Lead Automation Engineer',
    linkedProjects: ['_26-125 - HITACHI - Test szczelności dużych Kadzi'],
  },
  {
    name: 'Anna Nowak',
    email: 'a.nowak@izoblok.pl',
    client: 'IZOBLOK',
    role: 'Kierownik Utrzymania Ruchu',
    linkedProjects: ['_26-070 - IZOBLOK - Zgrzewanie Ultrasonic'],
  },
];

export const SAMPLE_EMAILS: SampleEmail[] = [
  {
    id: 'hitachi-schema',
    label: '26-125 HITACHI — Kod projektu + cytaty + wykrycie duplikatu Message-ID',
    messageId: '<hitachi-rev-c-20261120@mail.hitachi.com>',
    fromName: 'Jan Kowalski',
    fromEmail: 'jan.kowalski@hitachi.com',
    toName: 'Piotr Świerk',
    toEmail: 'p.swierk@trinitec.pl',
    date: '2026-11-20',
    subject: 'Re: [26-125] Schematy szafy AKPiA - rewizja C i termin odbioru',
    body: `Cześć Piotr,

Przesyłam w załączeniu zatwierdzony schemat szafy AKPiA (rewizja C) dla stanowiska testu szczelności dużych kadzi (projekt 26-125).

Pilne uwagi przed prefabrykacją:
1. Proszę odesłać zaktualizowaną listę materiałową BOM do 2026-11-25 — musimy zamknąć zakupy PLC.
2. Trzeba zweryfikować zabezpieczenia obwodów 24V DC na stronie 14 schematu przed 2026-11-27.
3. Prośba o potwierdzenie terminu testów FAT w naszym zakładzie.

-- 
Pozdrawiam,
Jan Kowalski | Lead Automation Engineer
Hitachi Energy Poland Sp. z o.o.
ul. Przykładowa 12, 30-001 Kraków | tel. +48 600 000 000
Treść tej wiadomości jest poufna i podlega tajemnicy przedsiębiorstwa.

W dniu 18.11.2026 o 14:22 Piotr Świerk napisał(a):
> Cześć Janek,
> Wysyłam wstępne rysunki szafy AKPiA (rewizja B) do komentarzy przed prefabrykacją.
> Daj znać, czy układ zasilaczy 24V DC oraz rezerwowych wejść I/O odpowiada standardowi zakładu.
>
> Pozdrawiam,
> Piotr Świerk`,
    htmlBody: `<p>Cześć Piotr,</p>
<p>Przesyłam w załączeniu zatwierdzony schemat szafy <strong>AKPiA (rewizja C)</strong> dla stanowiska testu szczelności dużych kadzi (projekt <code>26-125</code>).</p>
<img src="https://tracking.hitachi-mail.example/open-pixel.gif?id=9842" width="1" height="1" alt="tracker" />
<ol>
  <li>Proszę odesłać zaktualizowaną listę materiałową BOM do <strong>2026-11-25</strong>.</li>
  <li>Trzeba zweryfikować zabezpieczenia obwodów 24V DC na stronie 14 przed 2026-11-27.</li>
  <li>Prośba o potwierdzenie terminu testów FAT.</li>
</ol>
<img src="https://cdn.hitachi.example/logo-footer.png" alt="Logo firmowe" />`,
    attachments: [
      { filename: '26-125_schemat_szafy_AKPiA_revC.pdf', sizeBytes: 4_820_110, mimeType: 'application/pdf' },
      { filename: 'lista_sygnalow_IO_v3.xlsx', sizeBytes: 312_450, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ],
    sizeBytes: 5_290_000,
    imapFolder: 'INBOX',
  },
  {
    id: 'izoblok-contact',
    label: 'IZOBLOK — Brak kodu w treści (dopasowanie po kontakcie w kontakty/)',
    messageId: '<izoblok-pnoz-20261119@izoblok.pl>',
    fromName: 'Anna Nowak',
    fromEmail: 'a.nowak@izoblok.pl',
    toName: 'Piotr Świerk',
    toEmail: 'p.swierk@trinitec.pl',
    date: '2026-11-19',
    subject: 'Pytanie o czujniki bezpieczeństwa kurtyny świetlnej',
    body: `Dzień dobry Panie Piotrze,

Mam pytanie odnośnie kurtyn świetlnych dla naszego stanowiska zgrzewania ultradźwiękowego.
Czy możemy zastosować przekaźnik bezpieczeństwa Pilz PNOZ s4 zamiast wcześniej proponowanego modelu?

Proszę o przesłanie krótkiej odpowiedzi oraz zaktualizowanej karty katalogowej do 2026-11-24.

Z poważaniem,
Anna Nowak
Kierownik Utrzymania Ruchu | IZOBLOK S.A.

On Mon, 16 Nov 2026 at 09:11 Piotr Świerk wrote:
> W załączeniu zestawienie aparatury bezpieczeństwa dla zgrzewarki.`,
    htmlBody: `<p>Dzień dobry Panie Piotrze,</p>
<p>Czy możemy zastosować przekaźnik bezpieczeństwa <strong>Pilz PNOZ s4</strong> dla naszego stanowiska zgrzewania ultradźwiękowego?</p>
<p>Proszę o przesłanie odpowiedzi do 2026-11-24.</p>
<img src="https://izoblok.example/banner-stopka.jpg" alt="Stopka" />`,
    attachments: [
      { filename: 'PNOZ_s4_datasheet.pdf', sizeBytes: 1_140_220, mimeType: 'application/pdf' },
    ],
    sizeBytes: 1_240_000,
    imapFolder: 'INBOX',
  },
  {
    id: 'unknown-supplier',
    label: 'Nowy dostawca (Rittal) — Auto-Contact 1-click i wybór projektu',
    messageId: '<rittal-vx25-20261118@rittal-dystrybucja.pl>',
    fromName: 'Marek Zieliński',
    fromEmail: 'm.zielinski@rittal-dystrybucja.pl',
    toName: 'Piotr Świerk',
    toEmail: 'p.swierk@trinitec.pl',
    date: '2026-11-18',
    subject: 'Oferta cenowa na obudowy VX25 + klimatyzatory dachowe',
    body: `Witam Panie Piotrze,

W odpowiedzi na zapytanie ofertowe przesyłam wycenę obudów Rittal VX25 wraz z klimatyzatorami Blue e+.
Termin dostawy przy zamówieniu złożonym do 2026-11-28 wynosi 10 dni roboczych.

Proszę o potwierdzenie wymiarów cokołu i adresu dostawy.

--
Pozdrawiam,
Marek Zieliński
Dział Sprzedaży Technicznej`,
    htmlBody: `<p>Witam Panie Piotrze,</p>
<p>Przesyłam wycenę obudów <strong>Rittal VX25</strong> wraz z klimatyzatorami Blue e+.</p>
<p>Proszę o potwierdzenie wymiarów cokołu i adresu dostawy przed 2026-11-28.</p>`,
    attachments: [
      { filename: 'Oferta_Rittal_VX25_2026_11.pdf', sizeBytes: 892_400, mimeType: 'application/pdf' },
      { filename: 'Rysunek_wymiarowy_VX25.dwg', sizeBytes: 6_450_000, mimeType: 'application/acad' },
    ],
    sizeBytes: 7_420_000,
    imapFolder: 'INBOX/Oferty',
  },
];

export const MOCK_STORAGE_QUOTA = {
  usedBytes: 1_684_500_000,
  limitBytes: 2_147_483_648,
};

export const MOCK_STORAGE_FOLDERS: StorageFolderMetric[] = [
  { folder: 'INBOX', messages: 412, unread: 14, sizeBytes: 542_800_000, largestMessageBytes: 18_420_000 },
  { folder: 'Sent', messages: 685, unread: 0, sizeBytes: 618_300_000, largestMessageBytes: 22_150_000 },
  { folder: 'Archive', messages: 1290, unread: 0, sizeBytes: 398_200_000, largestMessageBytes: 14_700_000 },
  { folder: 'INBOX/Oferty', messages: 164, unread: 3, sizeBytes: 89_400_000, largestMessageBytes: 9_840_000 },
  { folder: 'INBOX/Raporty', messages: 58, unread: 1, sizeBytes: 28_600_000, largestMessageBytes: 6_320_000 },
  { folder: 'Trash', messages: 27, unread: 0, sizeBytes: 7_200_000, largestMessageBytes: 2_100_000 },
];

export const MOCK_LARGEST_MESSAGES: StorageMessageMetric[] = [
  {
    uid: 9842,
    folder: 'Sent',
    date: '2026-11-15',
    from: 'p.swierk@trinitec.pl',
    subject: '[26-125] Dokumentacja powykonawcza EPLAN + backup TIA Portal',
    sizeBytes: 22_150_000,
    attachmentCount: 4,
    projectCode: '26-125',
  },
  {
    uid: 9811,
    folder: 'INBOX',
    date: '2026-11-14',
    from: 'jan.kowalski@hitachi.com',
    subject: '26-125 Zdjęcia rozdzielnicy głównej + skany pomiarów',
    sizeBytes: 18_420_000,
    attachmentCount: 9,
    projectCode: '26-125',
  },
  {
    uid: 9704,
    folder: 'Archive',
    date: '2026-10-28',
    from: 'biuro@izoblok.pl',
    subject: '[26-070] Model 3D STEP stanowiska zgrzewania',
    sizeBytes: 14_700_000,
    attachmentCount: 2,
    projectCode: '26-070',
  },
  {
    uid: 9662,
    folder: 'INBOX/Oferty',
    date: '2026-11-18',
    from: 'm.zielinski@rittal-dystrybucja.pl',
    subject: 'Oferta cenowa na obudowy VX25 + rysunki CAD',
    sizeBytes: 9_840_000,
    attachmentCount: 3,
    projectCode: null,
  },
  {
    uid: 9615,
    folder: 'INBOX/Raporty',
    date: '2026-11-11',
    from: 'serwis@brembo.com',
    subject: '26-142 Raport termowizyjny szafy napędowej',
    sizeBytes: 6_320_000,
    attachmentCount: 5,
    projectCode: '26-142',
  },
  {
    uid: 9590,
    folder: 'INBOX',
    date: '2026-11-20',
    from: 'jan.kowalski@hitachi.com',
    subject: 'Re: [26-125] Schematy szafy AKPiA - rewizja C i termin odbioru',
    sizeBytes: 5_290_000,
    attachmentCount: 2,
    projectCode: '26-125',
  },
];
