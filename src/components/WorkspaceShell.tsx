import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Database,
  FileBarChart2,
  FolderSearch,
  History,
  Home,
  LayoutDashboard,
  Menu,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import { TruthLensLogo } from './TruthLensLogo';

export type WorkspaceTab =
  | 'overview'
  | 'upload'
  | 'analyses'
  | 'history'
  | 'reports'
  | 'datasets'
  | 'settings'
  | 'analysis-live'
  | 'report-detail';

interface WorkspaceShellProps {
  activeTab: WorkspaceTab;
  breadcrumb: string;
  onNavigate: (tab: WorkspaceTab) => void;
  onReturnHome: () => void;
  primaryAction?: ReactNode;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'upload', label: 'New analysis', icon: Upload },
  { id: 'analyses', label: 'My analyses', icon: FolderSearch },
  { id: 'history', label: 'Detection history', icon: History },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'datasets', label: 'Datasets', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function WorkspaceShell({
  activeTab,
  breadcrumb,
  onNavigate,
  onReturnHome,
  primaryAction,
  children,
}: WorkspaceShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isNavActive = (itemId: WorkspaceTab) => {
    if (activeTab === itemId) return true;
    if (activeTab === 'analysis-live' && itemId === 'analyses') return true;
    if (activeTab === 'report-detail' && itemId === 'reports') return true;
    return false;
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 flex items-center justify-between border-b border-[#E5EAF2]">
        <button
          type="button"
          onClick={onReturnHome}
          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-md"
        >
          <TruthLensLogo />
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-[#64748B] hover:text-[#172554] cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-[#2563EB]/10 text-[#2563EB]'
                  : 'text-[#64748B] hover:bg-[#F5F7FB] hover:text-[#172554]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[#E5EAF2]">
        <button
          type="button"
          onClick={onReturnHome}
          className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-[#64748B] hover:text-[#172554] hover:bg-[#F5F7FB] rounded-lg transition-colors cursor-pointer"
        >
          <Home className="w-4 h-4 shrink-0" />
          <span>Public homepage</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F7FB] text-[#172554] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[248px] shrink-0 bg-white border-r border-[#E5EAF2] sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#172554]/30"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-[264px] max-w-[85vw] bg-white h-full border-r border-[#E5EAF2] z-10">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Canvas */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-[#E5EAF2] px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[#64748B] hover:text-[#172554] cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#64748B] whitespace-nowrap">TruthLens</span>
              <span className="text-[#CBD5E1]" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-[#172554] truncate">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {primaryAction ?? (
              <button
                type="button"
                onClick={() => onNavigate('upload')}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload media
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-8 py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
