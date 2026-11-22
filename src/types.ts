export interface Student {
  id: string | number;
  no_absen: string | number;
  nama_lengkap: string;
  kelas?: string | null;
}

export interface Assignment {
  id: string | number;
  judul: string;
  instruksi_soal: string;
  kunci_rubrik?: string;
  created_at?: string;
}

export interface Submission {
  id: string | number;
  student_id: string | number;
  assignment_id: string | number;
  jawaban_teks: string;
  nilai: number;
  umpan_balik_ai: string;
  created_at?: string;
}

export interface SubmissionWithDetails extends Submission {
  student_name: string;
  student_no_absen: string | number;
  assignment_title: string;
}

export interface HealthStatus {
  ok: boolean;
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
}

export type ActiveTab = 'siswa' | 'guru';
