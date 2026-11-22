import type { ActiveTab, Student } from '../types';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  loggedInStudent: Student | null;
  onStudentLogout: () => void;
  onOpenStudentManager: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  loggedInStudent,
  onStudentLogout,
  onOpenStudentManager,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onTabChange('siswa')}
          className="text-left text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 rounded-md"
        >
          Asisten Guru SDN Nguling 3
        </button>

        <nav
          aria-label="Navigasi utama"
          className="flex items-center gap-6 sm:gap-8 h-full"
        >
          <button
            type="button"
            onClick={() => onTabChange('siswa')}
            aria-current={activeTab === 'siswa' ? 'page' : undefined}
            className={`relative h-full inline-flex items-center text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
              activeTab === 'siswa'
                ? 'text-teal-800 font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Portal Siswa
            {activeTab === 'siswa' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-700"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('guru')}
            aria-current={activeTab === 'guru' ? 'page' : undefined}
            className={`relative h-full inline-flex items-center text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
              activeTab === 'guru'
                ? 'text-teal-800 font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Dashboard Guru
            {activeTab === 'guru' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-700"
              />
            )}
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          {activeTab === 'guru' ? (
            <button
              type="button"
              onClick={onOpenStudentManager}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
            >
              Kelola Data Siswa
            </button>
          ) : loggedInStudent ? (
            <button
              type="button"
              onClick={onStudentLogout}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
            >
              Keluar Siswa
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onTabChange('guru')}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
            >
              Buka Dashboard Guru
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
