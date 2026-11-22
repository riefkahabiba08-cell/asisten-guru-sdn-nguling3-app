import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  createAssignmentData,
  deleteAssignmentData,
  fetchTeacherDashboardData,
  generateAssignmentPackageData,
} from '../lib/dataService';
import type {
  Assignment,
  GenerateAssignmentParams,
  Student,
  SubmissionWithDetails,
} from '../types';

interface DashboardGuruProps {
  refreshTrigger: number;
  onTableMissing: (message: string) => void;
  onOpenStudentManager: () => void;
}

export function DashboardGuru({
  refreshTrigger,
  onTableMissing,
  onOpenStudentManager,
}: DashboardGuruProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionWithDetails[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Generator Paket Soal Otomatis (AI)
  const [mataPelajaran, setMataPelajaran] = useState('IPAS');
  const [kelasAi, setKelasAi] = useState('Kelas 5 SD');
  const [topikMateri, setTopikMateri] = useState('');
  const [jumlahSoal, setJumlahSoal] = useState(5);
  const [jenisSoal, setJenisSoal] =
    useState<GenerateAssignmentParams['jenis_soal']>('Pilihan Ganda');
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccess, setAiSuccess] = useState<string | null>(null);

  // Form Buat Tugas Baru
  const [judul, setJudul] = useState('');
  const [instruksiSoal, setInstruksiSoal] = useState('');
  const [kunciRubrik, setKunciRubrik] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Assignment list controls
  const [expandedRubricId, setExpandedRubricId] = useState<
    string | number | null
  >(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<
    string | number | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  // Submissions filters & detail modal
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAssignmentId, setFilterAssignmentId] = useState<string>('all');
  const [selectedSubmission, setSelectedSubmission] =
    useState<SubmissionWithDetails | null>(null);

  const fetchAllTeacherData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchTeacherDashboardData();
      if (!res.ok || !res.data) {
        if (res.code === 'TABLE_MISSING' && res.error) {
          onTableMissing(res.error);
        }
        setLoadError(res.error || 'Gagal memuat data Dashboard Guru.');
        return;
      }

      setAssignments(res.data.assignments);
      setSubmissions(res.data.submissions);
      setStudents(res.data.students);
    } finally {
      setLoading(false);
    }
  }, [onTableMissing]);

  useEffect(() => {
    fetchAllTeacherData();
  }, [fetchAllTeacherData, refreshTrigger]);

  const handleGeneratePackageWithAi = async () => {
    if (!topikMateri.trim()) {
      setAiError(
        'Masukkan Topik / Materi terlebih dahulu untuk membuat paket soal otomatis.',
      );
      return;
    }

    setAiError(null);
    setAiSuccess(null);
    setFormError(null);
    setGeneratingAi(true);

    try {
      const res = await generateAssignmentPackageData({
        mata_pelajaran: mataPelajaran.trim() || 'Tematik SD',
        kelas: kelasAi,
        topik: topikMateri.trim(),
        jumlah_soal: jumlahSoal,
        jenis_soal: jenisSoal,
      });

      if (!res.ok || !res.data) {
        setAiError(
          res.error ||
            'Gagal membuat paket soal otomatis dengan AI. Pastikan GEMINI_API_KEY sudah dikonfigurasi.',
        );
        return;
      }

      const generated = res.data;
      setJudul(generated.judul);
      setInstruksiSoal(generated.instruksi_soal);
      setKunciRubrik(generated.kunci_rubrik);
      setAiSuccess(
        `Paket ${jumlahSoal} soal (${jenisSoal}) beserta kunci jawaban dan rubrik berhasil dibuat. Silakan tinjau atau langsung klik Simpan Tugas Baru.`,
      );
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleCreateAssignment = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setCreating(true);

    try {
      const res = await createAssignmentData({
        judul: judul.trim(),
        instruksi_soal: instruksiSoal.trim(),
        kunci_rubrik: kunciRubrik.trim(),
      });

      if (!res.ok || !res.data) {
        if (res.code === 'TABLE_MISSING' && res.error) {
          onTableMissing(res.error);
        }
        setFormError(res.error || 'Gagal menyimpan tugas baru.');
        return;
      }

      const createdTitle = res.data.judul;
      setJudul('');
      setInstruksiSoal('');
      setKunciRubrik('');
      setTopikMateri('');
      setAiSuccess(null);
      setFormSuccess(`Tugas "${createdTitle}" berhasil disimpan ke Supabase.`);
      await fetchAllTeacherData();
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteAssignment = async (id: string | number) => {
    setDeletingId(id);
    try {
      const res = await deleteAssignmentData(id);
      if (res.ok) {
        setConfirmDeleteId(null);
        await fetchAllTeacherData();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const filteredSubmissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return submissions.filter((sub) => {
      const matchesAssignment =
        filterAssignmentId === 'all' ||
        String(sub.assignment_id) === filterAssignmentId;
      if (!matchesAssignment) return false;
      if (!q) return true;
      return (
        sub.student_name.toLowerCase().includes(q) ||
        String(sub.student_no_absen).toLowerCase().includes(q) ||
        sub.assignment_title.toLowerCase().includes(q)
      );
    });
  }, [submissions, filterAssignmentId, searchQuery]);

  const averageScore = useMemo(() => {
    if (filteredSubmissions.length === 0) return null;
    const total = filteredSubmissions.reduce(
      (acc, s) => acc + Number(s.nilai || 0),
      0,
    );
    return (total / filteredSubmissions.length).toFixed(1);
  }, [filteredSubmissions]);

  const handleExportCsv = () => {
    const headers = [
      'No Absen',
      'Nama Siswa',
      'Judul Tugas',
      'Nilai',
      'Status',
      'Jawaban Siswa',
      'Umpan Balik AI',
      'Waktu Pengumpulan',
    ];
    const escapeCsv = (val: string | number | undefined | null) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };
    const rows = filteredSubmissions.map((s) => [
      escapeCsv(s.student_no_absen),
      escapeCsv(s.student_name),
      escapeCsv(s.assignment_title),
      escapeCsv(s.nilai),
      escapeCsv(s.nilai >= 75 ? 'Tuntas' : 'Perlu Bimbingan'),
      escapeCsv(s.jawaban_teks),
      escapeCsv(s.umpan_balik_ai),
      escapeCsv(s.created_at || ''),
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rekap-nilai-sdn-nguling-3.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-600">
            SDN Nguling 3 · Administrasi & Penilaian Otomatis
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900">
            Dashboard Guru
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenStudentManager}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Users className="w-4 h-4" />
            <span>Kelola Data Siswa</span>
          </button>
          <button
            type="button"
            onClick={fetchAllTeacherData}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Muat Ulang Data</span>
          </button>
        </div>
      </div>

      <section
        aria-label="Ringkasan Kelas"
        className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-slate-200"
      >
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Total Tugas Aktif
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {assignments.length}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Total Jawaban Masuk
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {filteredSubmissions.length}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Rata-Rata Nilai
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {averageScore !== null ? averageScore : '—'}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Siswa Terdaftar
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {students.length}
          </div>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl"
        >
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Buat Tugas Baru
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Buat paket soal secara otomatis dengan AI dalam satu klik atau isi
              formulir secara manual untuk diterbitkan ke Portal Siswa.
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Generator Paket Soal Otomatis (AI)
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Tentukan detail paket soal agar AI menyusun seluruh soal, kunci
                jawaban, dan rubrik penilaiannya secara otomatis.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="ai-subject"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Mata Pelajaran
                </label>
                <input
                  id="ai-subject"
                  type="text"
                  list="sd-subjects-list"
                  disabled={generatingAi}
                  placeholder="Contoh: Matematika"
                  value={mataPelajaran}
                  onChange={(e) => setMataPelajaran(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                />
                <datalist id="sd-subjects-list">
                  <option value="Bahasa Indonesia" />
                  <option value="Matematika" />
                  <option value="IPAS" />
                  <option value="Pendidikan Pancasila" />
                  <option value="PJOK" />
                  <option value="Seni Budaya" />
                  <option value="Bahasa Inggris" />
                  <option value="Pendidikan Agama" />
                </datalist>
              </div>

              <div>
                <label
                  htmlFor="ai-grade"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Kelas
                </label>
                <select
                  id="ai-grade"
                  value={kelasAi}
                  onChange={(e) => setKelasAi(e.target.value)}
                  disabled={generatingAi}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                >
                  <option value="Kelas 1 SD">Kelas 1 SD</option>
                  <option value="Kelas 2 SD">Kelas 2 SD</option>
                  <option value="Kelas 3 SD">Kelas 3 SD</option>
                  <option value="Kelas 4 SD">Kelas 4 SD</option>
                  <option value="Kelas 5 SD">Kelas 5 SD</option>
                  <option value="Kelas 6 SD">Kelas 6 SD</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="ai-topic"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Topik / Materi
              </label>
              <input
                id="ai-topic"
                type="text"
                disabled={generatingAi}
                placeholder="Contoh: Rantai makanan dan keseimbangan ekosistem"
                value={topikMateri}
                onChange={(e) => setTopikMateri(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="ai-count"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Jumlah Soal
                </label>
                <input
                  id="ai-count"
                  type="number"
                  min={1}
                  max={25}
                  disabled={generatingAi}
                  value={jumlahSoal}
                  onChange={(e) =>
                    setJumlahSoal(
                      Math.max(1, Math.min(25, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                />
              </div>

              <div>
                <label
                  htmlFor="ai-type"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Jenis Soal
                </label>
                <select
                  id="ai-type"
                  value={jenisSoal}
                  onChange={(e) =>
                    setJenisSoal(
                      e.target.value as GenerateAssignmentParams['jenis_soal'],
                    )
                  }
                  disabled={generatingAi}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                >
                  <option value="Pilihan Ganda">Pilihan Ganda</option>
                  <option value="Isian Singkat">Isian Singkat</option>
                  <option value="Uraian">Uraian</option>
                  <option value="Campuran">Campuran</option>
                </select>
              </div>
            </div>

            {aiError && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{aiError}</span>
              </div>
            )}

            {aiSuccess && (
              <div
                role="status"
                className="flex items-start gap-2 p-3 text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <span>{aiSuccess}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleGeneratePackageWithAi}
              disabled={generatingAi || !topikMateri.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-300 disabled:opacity-60 rounded-lg transition-colors min-h-[42px]"
            >
              {generatingAi ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                  <span>Menyusun {jumlahSoal} Soal & Kunci Jawaban...</span>
                </>
              ) : (
                <>
                  <PenLine className="w-4 h-4 text-teal-700" />
                  <span>Buat Paket Soal Otomatis (AI)</span>
                </>
              )}
            </button>
          </div>

          <form onSubmit={handleCreateAssignment} className="space-y-4">
            <div>
              <label
                htmlFor="assignment-title"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Judul Tugas
              </label>
              <input
                id="assignment-title"
                type="text"
                required
                placeholder="Contoh: IPAS Kelas 5 SD - Rantai Makanan"
                value={judul}
                onChange={(e) => setJudul(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[42px]"
              />
            </div>

            <div>
              <label
                htmlFor="assignment-instructions"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Instruksi & Daftar Soal
              </label>
              <textarea
                id="assignment-instructions"
                rows={6}
                required
                placeholder="Tuliskan petunjuk pengerjaan dan daftar pertanyaan untuk siswa..."
                value={instruksiSoal}
                onChange={(e) => setInstruksiSoal(e.target.value)}
                className="w-full p-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 leading-relaxed"
              />
            </div>

            <div>
              <label
                htmlFor="assignment-rubric"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Kunci Jawaban & Rubrik Penilaian
              </label>
              <textarea
                id="assignment-rubric"
                rows={5}
                required
                placeholder="Kunci jawaban bernomor dan pedoman penilaian skor 0-100..."
                value={kunciRubrik}
                onChange={(e) => setKunciRubrik(e.target.value)}
                className="w-full p-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 leading-relaxed"
              />
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div
                role="status"
                className="flex items-start gap-2 p-3 text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <span>{formSuccess}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={creating}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors min-h-[44px]"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Menyimpan Tugas...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Simpan Tugas Baru</span>
                </>
              )}
            </button>
          </form>

          <div className="border-t border-slate-200 pt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Daftar Tugas Aktif
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {assignments.length} tugas
              </span>
            </div>

            {assignments.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                Belum ada tugas tersimpan.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {assignments.map((a) => {
                  const isExpanded =
                    String(expandedRubricId) === String(a.id);
                  const isConfirmingDelete =
                    String(confirmDeleteId) === String(a.id);
                  return (
                    <li
                      key={String(a.id)}
                      className="py-3.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-slate-900">
                            {a.judul}
                          </h4>
                          <p className="mt-1 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                            {a.instruksi_soal}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRubricId(isExpanded ? null : a.id)
                            }
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
                          >
                            {isExpanded ? 'Tutup Rubrik' : 'Rubrik'}
                          </button>
                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={deletingId === a.id}
                                onClick={() => handleDeleteAssignment(a.id)}
                                className="px-2 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
                              >
                                Hapus
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Hapus tugas ${a.judul}`}
                              onClick={() => setConfirmDeleteId(a.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {isExpanded && a.kunci_rubrik && (
                        <div className="mt-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                          <span className="font-semibold text-slate-900 block mb-1">
                            Kunci Rubrik:
                          </span>
                          {a.kunci_rubrik}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Rekap Nilai Siswa
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Gabungan hasil koreksi AI dari tabel submissions, nama siswa,
                  dan judul tugas.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredSubmissions.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Download className="w-4 h-4" />
                <span>Unduh CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-7 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  aria-label="Cari siswa atau judul tugas"
                  placeholder="Cari nama siswa, no. absen, atau judul tugas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                />
              </div>

              <div className="sm:col-span-5">
                <select
                  aria-label="Filter berdasarkan tugas"
                  value={filterAssignmentId}
                  onChange={(e) => setFilterAssignmentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                >
                  <option value="all">Semua Tugas</option>
                  {assignments.map((a) => (
                    <option key={String(a.id)} value={String(a.id)}>
                      {a.judul}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              <div className="h-10 bg-slate-100 rounded animate-pulse" />
              <div className="h-10 bg-slate-100 rounded animate-pulse" />
              <div className="h-10 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-slate-700">
                Belum ada rekap nilai yang sesuai
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Jawaban yang dikirim siswa di Portal Siswa akan otomatis muncul
                di tabel ini.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Absen
                    </th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-600">
                      Nama Siswa
                    </th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-600">
                      Judul Tugas
                    </th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Nilai
                    </th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      Status
                    </th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredSubmissions.map((sub) => {
                    const isPass = sub.nilai >= 75;
                    return (
                      <tr
                        key={String(sub.id)}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {String(sub.student_no_absen)}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {sub.student_name}
                        </td>
                        <td className="py-3 px-4 text-slate-700 max-w-[220px] truncate">
                          {sub.assignment_title}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                          {sub.nilai}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            {isPass ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span className="text-emerald-700">Tuntas</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span className="text-amber-700">
                                  Perlu Bimbingan
                                </span>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedSubmission(sub)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 px-2.5 py-1.5 rounded-md hover:bg-teal-50 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Detail</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selectedSubmission && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submission-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span className="font-mono tabular-nums">
                    Absen {String(selectedSubmission.student_no_absen)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedSubmission.assignment_title}</span>
                </div>
                <h3
                  id="submission-detail-title"
                  className="mt-0.5 text-lg font-bold text-slate-900"
                >
                  {selectedSubmission.student_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                aria-label="Tutup detail jawaban"
                className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-sm font-medium text-slate-700">
                  Nilai Hasil Koreksi AI
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {selectedSubmission.nilai}/100
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold">
                    {selectedSubmission.nilai >= 75 ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-700">Tuntas</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        <span className="text-amber-700">Perlu Bimbingan</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-1.5">
                  Jawaban Siswa
                </h4>
                <div className="p-4 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedSubmission.jawaban_teks}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-500 mb-1.5">
                  Umpan Balik AI
                </h4>
                <div className="p-4 bg-teal-50/50 border border-teal-200 rounded-lg text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedSubmission.umpan_balik_ai}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
