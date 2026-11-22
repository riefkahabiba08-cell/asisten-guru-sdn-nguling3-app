import { useState } from 'react';
import { AlertTriangle, Check, Copy, Database } from 'lucide-react';

interface DatabaseSetupNoticeProps {
  reason: 'env_missing' | 'table_missing';
  errorMessage?: string;
}

const SUPABASE_SCHEMA_SQL = `-- Jalankan skrip ini di SQL Editor Supabase Anda
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  no_absen TEXT NOT NULL UNIQUE,
  nama_lengkap TEXT NOT NULL,
  pin TEXT NOT NULL,
  kelas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judul TEXT NOT NULL,
  instruksi_soal TEXT NOT NULL,
  kunci_rubrik TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  jawaban_teks TEXT NOT NULL,
  nilai INTEGER NOT NULL CHECK (nilai >= 0 AND nilai <= 100),
  umpan_balik_ai TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pastikan kebijakan akses (RLS) mengizinkan SELECT, INSERT, UPDATE, DELETE
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access students" ON students;
CREATE POLICY "Allow full access students" ON students
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access assignments" ON assignments;
CREATE POLICY "Allow full access assignments" ON assignments
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access submissions" ON submissions;
CREATE POLICY "Allow full access submissions" ON submissions
  FOR ALL USING (true) WITH CHECK (true);

-- Contoh data awal siswa untuk uji coba
INSERT INTO students (no_absen, nama_lengkap, pin, kelas) VALUES
  ('01', 'Ahmad Fauzan', '1234', 'Kelas 5A'),
  ('02', 'Siti Nurhaliza', '5678', 'Kelas 5A')
ON CONFLICT (no_absen) DO NOTHING;`;

export function DatabaseSetupNotice({
  reason,
  errorMessage,
}: DatabaseSetupNoticeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      aria-label="Informasi Koneksi Supabase"
      className="max-w-5xl mx-auto mt-6 px-4 sm:px-6 lg:px-8"
    >
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-slate-900">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              {reason === 'env_missing'
                ? 'Konfigurasi Variabel Lingkungan Supabase Diperlukan'
                : 'Tabel Database Supabase Belum Tersedia'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">
              {reason === 'env_missing'
                ? 'Pastikan variabel NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, dan GEMINI_API_KEY sudah diatur pada panel Secrets / Environment.'
                : errorMessage ||
                  'Koneksi ke Supabase berhasil, namun tabel students, assignments, atau submissions belum dibuat.'}
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <Database className="w-4 h-4 text-slate-600" />
                  <span>Referensi Skema SQL Supabase (students, assignments, submissions)</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-100/60 transition-colors whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-teal-700" />
                      <span>Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin SQL Skema</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 bg-white border border-amber-200 rounded-lg text-xs font-mono text-slate-800 overflow-x-auto leading-relaxed">
                {SUPABASE_SCHEMA_SQL}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
