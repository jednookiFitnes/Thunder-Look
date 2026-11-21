/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { BuildStatusResponse, RealSourceFile, StudioTab } from './types/generator';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { InstallDashboardView } from './components/InstallDashboardView';
import { EmailSettingsView } from './components/EmailSettingsView';
import { CodeExplorerView } from './components/CodeExplorerView';
import { SimulatorView } from './components/SimulatorView';
import { SetupGuideView } from './components/SetupGuideView';

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('install');
  const [status, setStatus] = useState<BuildStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [files, setFiles] = useState<RealSourceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [downloadingReady, setDownloadingReady] = useState(false);
  const [downloadingFull, setDownloadingFull] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    window.setTimeout(() => {
      setToastMessage((current) => (current === message ? null : current));
    }, 3400);
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BuildStatusResponse;
      setStatus(data);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Błąd połączenia z backendem');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    setFilesError(null);
    try {
      const res = await fetch('/api/files');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { files: RealSourceFile[] };
      setFiles(data.files);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Błąd odczytu plików');
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchFiles();
  }, [fetchStatus, fetchFiles]);

  const triggerDownload = async (
    endpoint: string,
    filename: string,
    setBusy: (v: boolean) => void,
    successText: string
  ) => {
    setBusy(true);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(successText);
    } catch (err) {
      showToast(`Błąd pobierania: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadReadyZip = () => {
    if (downloadingReady) return;
    void triggerDownload(
      '/api/download/plugin-ready',
      'trinitec-mail-project-manager-ready.zip',
      setDownloadingReady,
      'Pobrano gotową wtyczkę Obsidian ZIP (main.js + manifest.json + styles.css + install-to-vault.ps1).'
    );
  };

  const handleDownloadFullZip = () => {
    if (downloadingFull) return;
    void triggerDownload(
      '/api/download/full-bundle',
      'trinitec-mail-full-repo-and-mcp.zip',
      setDownloadingFull,
      'Pobrano pełny pakiet: źródła + skompilowana wtyczka + MCP Server & CLI.'
    );
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#141519] text-[#E6E8EF]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onDownloadReadyZip={handleDownloadReadyZip}
        isDownloading={downloadingReady}
      />

      <div className="flex-1 min-h-0 flex">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          status={status}
          onDownloadFullZip={handleDownloadFullZip}
          downloadingFull={downloadingFull}
        />

        <main className="flex-1 min-w-0 bg-[#181A20] overflow-y-auto">
          {activeTab === 'install' && (
            <InstallDashboardView
              status={status}
              loadingStatus={loadingStatus}
              statusError={statusError}
              onRefreshStatus={() => void fetchStatus()}
              onDownloadReadyZip={handleDownloadReadyZip}
              onDownloadFullZip={handleDownloadFullZip}
              downloadingReady={downloadingReady}
              downloadingFull={downloadingFull}
              onNavigateCode={() => setActiveTab('code')}
              onNavigateSetup={() => setActiveTab('setup')}
            />
          )}
          {activeTab === 'email-settings' && <EmailSettingsView onNotify={showToast} />}
          {activeTab === 'code' && (
            <CodeExplorerView
              files={files}
              loading={loadingFiles}
              error={filesError}
              onRetry={() => void fetchFiles()}
              onNotify={showToast}
            />
          )}
          {activeTab === 'simulator' && <SimulatorView onNotify={showToast} />}
          {activeTab === 'setup' && <SetupGuideView onNotify={showToast} />}
        </main>
      </div>

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 px-4 py-2.5 text-xs font-medium text-[#E6E8EF] bg-[#232631] border border-[#393D4F] rounded-md shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
