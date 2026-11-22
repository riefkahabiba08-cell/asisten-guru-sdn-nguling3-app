import { useCallback, useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { PortalSiswa } from './components/PortalSiswa';
import { DashboardGuru } from './components/DashboardGuru';
import { DatabaseSetupNotice } from './components/DatabaseSetupNotice';
import { StudentManagerModal } from './components/StudentManagerModal';
import { StudentLoginCardsModal } from './components/StudentLoginCardsModal';
import { PrintableAssignmentModal } from './components/PrintableAssignmentModal';
import {
  TEACHER_AUTH_STORAGE_KEY,
  TeacherAuthGate,
} from './components/TeacherAuthGate';
import { isClientSupabaseConfigured } from './lib/supabase';
import type { ActiveTab, Assignment, HealthStatus, Student } from './types';

function readInitialTeacherUnlocked(): boolean {
  try {
    return sessionStorage.getItem(TEACHER_AUTH_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('siswa');
  const [loggedInStudent, setLoggedInStudent] = useState<Student | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [tableMissingMessage, setTableMissingMessage] = useState<string | null>(
    null,
  );
  const [teacherUnlocked, setTeacherUnlocked] = useState<boolean>(
    readInitialTeacherUnlocked,
  );
  const [teacherAuthModalOpen, setTeacherAuthModalOpen] = useState(false);
  const [pendingStudentModalOpen, setPendingStudentModalOpen] = useState(false);
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [printCardsOpen, setPrintCardsOpen] = useState(false);
  const [printCardsStudents, setPrintCardsStudents] = useState<Student[]>([]);
  const [printableAssignment, setPrintableAssignment] =
    useState<Assignment | null>(null);
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

  const handleOpenStudentManager = () => {
    if (teacherUnlocked) {
      setStudentModalOpen(true);
      return;
    }
    setPendingStudentModalOpen(true);
    setTeacherAuthModalOpen(true);
  };

  const handleOpenPrintCards = (studentsList: Student[]) => {
    setPrintCardsStudents(studentsList);
    setPrintCardsOpen(true);
  };

  const handleTeacherUnlockSuccess = () => {
    setTeacherUnlocked(true);
    setTeacherAuthModalOpen(false);
    if (pendingStudentModalOpen) {
      setPendingStudentModalOpen(false);
      setStudentModalOpen(true);
    }
  };

  const handleLockTeacher = () => {
    try {
      sessionStorage.removeItem(TEACHER_AUTH_STORAGE_KEY);
    } catch {
      // Abaikan jika sessionStorage tidak tersedia
    }
    setTeacherUnlocked(false);
    setStudentModalOpen(false);
    setPrintCardsOpen(false);
    setPrintableAssignment(null);
    setPendingStudentModalOpen(false);
    setTeacherAuthModalOpen(false);
  };

  const hasValidSupabase = Boolean(
    health?.supabaseConfigured || isClientSupabaseConfigured,
  );
  const hasActivePrintOverlay =
    printCardsOpen || Boolean(printableAssignment);

  return (
    <>
      <div
        className={`min-h-screen flex flex-col bg-slate-50 text-slate-900 ${
          hasActivePrintOverlay ? 'print:hidden' : ''
        }`}
      >
        <TopBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          loggedInStudent={loggedInStudent}
          onStudentLogout={() => setLoggedInStudent(null)}
          onOpenStudentManager={handleOpenStudentManager}
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
          ) : teacherUnlocked ? (
            <DashboardGuru
              refreshTrigger={teacherRefreshTrigger}
              onTableMissing={handleTableMissing}
              onOpenStudentManager={handleOpenStudentManager}
              onOpenPrintCards={handleOpenPrintCards}
              onOpenPrintableAssignment={(assignment) =>
                setPrintableAssignment(assignment)
              }
              onLockTeacher={handleLockTeacher}
            />
          ) : (
            <TeacherAuthGate
              onUnlockSuccess={handleTeacherUnlockSuccess}
              onCancel={() => {
                setPendingStudentModalOpen(false);
                setActiveTab('siswa');
              }}
            />
          )}
        </div>

        {teacherAuthModalOpen && !teacherUnlocked && (
          <TeacherAuthGate
            isModal
            onUnlockSuccess={handleTeacherUnlockSuccess}
            onCancel={() => {
              setPendingStudentModalOpen(false);
              setTeacherAuthModalOpen(false);
            }}
          />
        )}

        <StudentManagerModal
          isOpen={teacherUnlocked && studentModalOpen}
          onClose={() => setStudentModalOpen(false)}
          onStudentsChanged={() => setTeacherRefreshTrigger((n) => n + 1)}
          onOpenPrintCards={handleOpenPrintCards}
        />

        <footer className="border-t border-slate-200 bg-white mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>Asisten Guru SDN Nguling 3</span>
            <span>Portal Evaluasi & Administrasi Kelas SD</span>
          </div>
        </footer>
      </div>

      {teacherUnlocked && printCardsOpen && (
        <StudentLoginCardsModal
          isOpen={printCardsOpen}
          onClose={() => setPrintCardsOpen(false)}
          initialStudents={printCardsStudents}
        />
      )}

      {teacherUnlocked && printableAssignment && (
        <PrintableAssignmentModal
          assignment={printableAssignment}
          onClose={() => setPrintableAssignment(null)}
        />
      )}
    </>
  );
}
