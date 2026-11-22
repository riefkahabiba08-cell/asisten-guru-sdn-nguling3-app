import { useCallback, useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { PortalSiswa } from './components/PortalSiswa';
import { DashboardGuru } from './components/DashboardGuru';
import { DatabaseSetupNotice } from './components/DatabaseSetupNotice';
import { StudentManagerModal } from './components/StudentManagerModal';
import { isClientSupabaseConfigured } from './lib/supabase';
import type { ActiveTab, HealthStatus, Student } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('siswa');
  const [loggedInStudent, setLoggedInStudent] = useState<Student | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [tableMissingMessage, setTableMissingMessage] = useState<string | null>(
    null,
  );
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [teacherRefreshTrigger, setTeacherRefreshTrigger] = useState(0);

  useEffect(() => {
    if (isClientSupabaseConfigured) {
      setHealth({
        ok: true,
        supabaseConfigured: true,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      });
      return;
    }

    let active = true;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: HealthStatus | null) => {
        if (active && data) {
          setHealth(data);
        }
      })
      .catch(() => {
        if (active) {
          setHealth(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleTableMissing = useCallback((message: string) => {
    setTableMissingMessage(message);
  }, []);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    setTableMissingMessage(null);
  };

  const hasValidSupabase = Boolean(
    health?.supabaseConfigured || isClientSupabaseConfigured,
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        loggedInStudent={loggedInStudent}
        onStudentLogout={() => setLoggedInStudent(null)}
        onOpenStudentManager={() => setStudentModalOpen(true)}
      />

      {health !== null && !hasValidSupabase && (
        <DatabaseSetupNotice reason="env_missing" />
      )}

      {hasValidSupabase && tableMissingMessage && (
        <DatabaseSetupNotice
          reason="table_missing"
          errorMessage={tableMissingMessage}
        />
      )}

      <div className="flex-1">
        {activeTab === 'siswa' ? (
          <PortalSiswa
            student={loggedInStudent}
            onLoginSuccess={(student) => setLoggedInStudent(student)}
            onTableMissing={handleTableMissing}
          />
        ) : (
          <DashboardGuru
            refreshTrigger={teacherRefreshTrigger}
            onTableMissing={handleTableMissing}
            onOpenStudentManager={() => setStudentModalOpen(true)}
          />
        )}
      </div>

      <StudentManagerModal
        isOpen={studentModalOpen}
        onClose={() => setStudentModalOpen(false)}
        onStudentsChanged={() => setTeacherRefreshTrigger((n) => n + 1)}
      />

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Asisten Guru SDN Nguling 3</span>
          <span>Portal Evaluasi & Administrasi Kelas SD</span>
        </div>
      </footer>
    </div>
  );
}
