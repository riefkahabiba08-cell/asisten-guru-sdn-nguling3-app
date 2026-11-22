import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  bulkImportStudentsData,
  createStudentData,
  deleteStudentData,
  extractStudentsFromFileData,
  fetchStudentsData,
  generateUniqueFourDigitPin,
  updateStudentData,
} from '../lib/dataService';
import type { Student, StudentInput } from '../types';

interface StudentManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStudentsChanged: () => void;
}

function parseBulkStudentsText(raw: string): {
  valid: StudentInput[];
  invalidLines: number[];
} {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const valid: StudentInput[] = [];
  const invalidLines: number[] = [];

  lines.forEach((line, index) => {
    const delimiter = line.includes('\t')
      ? '\t'
      : line.includes(';')
        ? ';'
        : ',';
    const parts = line.split(delimiter).map((p) => p.trim());

    // Lewati baris header jika ada
    if (
      index === 0 &&
      parts[0]?.toLowerCase().includes('absen') &&
      parts[1]?.toLowerCase().includes('nama')
    ) {
      return;
    }

    const no_absen = parts[0] || '';
    const nama_lengkap = parts[1] || '';
    const pin = parts[2] || '';
    const kelas = parts[3] || '';

    if (!no_absen || !nama_lengkap || !pin) {
      invalidLines.push(index + 1);
      return;
    }

    valid.push({
      no_absen,
      nama_lengkap,
      pin,
      kelas: kelas || undefined,
    });
  });

  return { valid, invalidLines };
}

export function StudentManagerModal({
  isOpen,
  onClose,
  onStudentsChanged,
}: StudentManagerModalProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formFeedback, setFormFeedback] = useState<string | null>(null);

  const [mode, setMode] = useState<'single' | 'bulk' | 'file'>('single');

  // Tambah siswa satuan
  const [noAbsen, setNoAbsen] = useState('');
  const [namaLengkap, setNamaLengkap] = useState('');
  const [pin, setPin] = useState('');
  const [kelas, setKelas] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Impor massal CSV/teks
  const [bulkText, setBulkText] = useState('');
  const [importing, setImporting] = useState(false);

  // Upload File Data Siswa Otomatis (AI)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);
  const [previewStudents, setPreviewStudents] = useState<StudentInput[]>([]);
  const [savingPreview, setSavingPreview] = useState(false);

  // Edit & hapus siswa
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editNoAbsen, setEditNoAbsen] = useState('');
  const [editNamaLengkap, setEditNamaLengkap] = useState('');
  const [editPin, setEditPin] = useState('');
  const [editKelas, setEditKelas] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<
    string | number | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchStudentsData();
    if (!res.ok) {
      setError(res.error || 'Gagal memuat daftar siswa.');
      setStudents([]);
    } else {
      setStudents(res.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadStudents();
      setFormFeedback(null);
      setError(null);
      setEditingId(null);
      setConfirmDeleteId(null);
    }
  }, [isOpen, loadStudents]);

  const parsedBulk = useMemo(() => parseBulkStudentsText(bulkText), [bulkText]);

  if (!isOpen) return null;

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFormFeedback(null);
    setSubmitting(true);

    try {
      const res = await createStudentData({
        no_absen: noAbsen.trim(),
        nama_lengkap: namaLengkap.trim(),
        pin: pin.trim(),
        kelas: kelas.trim() || undefined,
      });

      if (!res.ok || !res.data) {
        setError(res.error || 'Gagal menambahkan data siswa.');
      } else {
        setNoAbsen('');
        setNamaLengkap('');
        setPin('');
        setKelas('');
        setFormFeedback(
          `Siswa "${res.data.nama_lengkap}" berhasil ditambahkan ke tabel students.`,
        );
        await loadStudents();
        onStudentsChanged();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkImport = async () => {
    setError(null);
    setFormFeedback(null);

    if (parsedBulk.valid.length === 0) {
      setError(
        'Belum ada baris data siswa yang valid. Gunakan format: No Absen, Nama Lengkap, PIN, Kelas.',
      );
      return;
    }

    setImporting(true);
    try {
      const res = await bulkImportStudentsData(parsedBulk.valid);
      if (!res.ok) {
        setError(res.error || 'Gagal mengimpor data siswa.');
      } else {
        setBulkText('');
        setFormFeedback(
          `Berhasil mengimpor ${res.data?.length ?? parsedBulk.valid.length} siswa ke tabel students.`,
        );
        await loadStudents();
        onStudentsChanged();
      }
    } finally {
      setImporting(false);
    }
  };

  const startEdit = (student: Student) => {
    setEditingId(student.id);
    setEditNoAbsen(String(student.no_absen));
    setEditNamaLengkap(student.nama_lengkap);
    setEditPin(String(student.pin ?? ''));
    setEditKelas(student.kelas || '');
    setConfirmDeleteId(null);
    setError(null);
    setFormFeedback(null);
  };

  const handleSaveEdit = async (id: string | number) => {
    if (!editNoAbsen.trim() || !editNamaLengkap.trim() || !editPin.trim()) {
      setError('No. Absen, Nama Lengkap, dan PIN wajib diisi saat mengedit.');
      return;
    }

    setSavingEdit(true);
    setError(null);
    setFormFeedback(null);
    try {
      const res = await updateStudentData(id, {
        no_absen: editNoAbsen.trim(),
        nama_lengkap: editNamaLengkap.trim(),
        pin: editPin.trim(),
        kelas: editKelas.trim() || undefined,
      });

      if (!res.ok || !res.data) {
        setError(res.error || 'Gagal memperbarui data siswa.');
      } else {
        setEditingId(null);
        setFormFeedback(
          `Data siswa "${res.data.nama_lengkap}" berhasil diperbarui.`,
        );
        await loadStudents();
        onStudentsChanged();
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    setDeletingId(student.id);
    setError(null);
    setFormFeedback(null);
    try {
      const res = await deleteStudentData(student.id);
      if (!res.ok) {
        setError(res.error || 'Gagal menghapus data siswa.');
      } else {
        setConfirmDeleteId(null);
        setFormFeedback(
          `Siswa "${student.nama_lengkap}" berhasil dihapus dari tabel students.`,
        );
        await loadStudents();
        onStudentsChanged();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const processSelectedFile = async (file: File) => {
    setError(null);
    setFormFeedback(null);
    setSelectedFileName(file.name);
    setExtractingFile(true);

    try {
      const existingPins = new Set(
        students.map((s) => String(s.pin ?? '').trim()).filter(Boolean),
      );
      const res = await extractStudentsFromFileData(file, existingPins);
      if (!res.ok || !res.data) {
        setError(res.error || 'Gagal membaca daftar siswa dari file.');
        return;
      }

      setPreviewStudents(res.data);
      setFormFeedback(
        `Berhasil membaca ${res.data.length} siswa dari "${file.name}". Periksa atau ubah data di tabel pratinjau sebelum menyimpan ke database.`,
      );
    } finally {
      setExtractingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handlePreviewFieldChange = (
    index: number,
    field: keyof StudentInput,
    value: string,
  ) => {
    setPreviewStudents((prev) =>
      prev.map((row, idx) =>
        idx === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const handleRegeneratePreviewPin = (index: number) => {
    const usedPins = new Set<string>([
      ...students.map((s) => String(s.pin ?? '').trim()).filter(Boolean),
      ...previewStudents.map((s) => String(s.pin ?? '').trim()).filter(Boolean),
    ]);
    const newPin = generateUniqueFourDigitPin(usedPins);
    handlePreviewFieldChange(index, 'pin', newPin);
  };

  const handleRemovePreviewRow = (index: number) => {
    setPreviewStudents((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSavePreviewToDatabase = async () => {
    setError(null);
    setFormFeedback(null);

    const cleaned = previewStudents
      .map((s) => ({
        no_absen: s.no_absen.trim(),
        nama_lengkap: s.nama_lengkap.trim(),
        pin: s.pin.trim(),
        kelas: s.kelas?.trim() || undefined,
      }))
      .filter((s) => s.no_absen && s.nama_lengkap && s.pin);

    if (cleaned.length === 0) {
      setError(
        'Daftar pratinjau kosong atau belum lengkap. Pastikan No. Absen, Nama Lengkap, dan PIN terisi.',
      );
      return;
    }

    setSavingPreview(true);
    try {
      const res = await bulkImportStudentsData(cleaned);
      if (!res.ok) {
        setError(res.error || 'Gagal menyimpan daftar siswa ke database.');
        return;
      }

      setFormFeedback(
        `Berhasil menyimpan ${res.data?.length ?? cleaned.length} siswa ke tabel students Supabase. Anda juga dapat mengunduh daftar PIN siswa (CSV).`,
      );
      await loadStudents();
      onStudentsChanged();
    } finally {
      setSavingPreview(false);
    }
  };

  const downloadPinCsv = (
    rows: Array<{
      no_absen: string | number;
      nama_lengkap: string;
      kelas?: string | null;
      pin?: string;
    }>,
    filename: string,
  ) => {
    if (rows.length === 0) return;
    const headers = ['No Absen', 'Nama Lengkap', 'Kelas', 'PIN Login'];
    const escapeCsv = (val: string | number | null | undefined) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };
    const csvLines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          escapeCsv(r.no_absen),
          escapeCsv(r.nama_lengkap),
          escapeCsv(r.kelas || ''),
          escapeCsv(r.pin || ''),
        ].join(','),
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2
              id="student-manager-title"
              className="text-lg font-semibold text-slate-900"
            >
              Kelola Data Siswa SDN Nguling 3
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Tambah siswa satuan, impor massal (CSV/teks), ubah, atau hapus
              data siswa langsung ke tabel students.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup jendela kelola siswa"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('single');
                  setError(null);
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'single'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tambah Siswa Satuan
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('bulk');
                  setError(null);
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'bulk'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Impor Massal (Teks / CSV)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('file');
                  setError(null);
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'file'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Upload File Otomatis (AI)
              </button>
            </div>
          </div>

          {mode === 'single' ? (
            <form onSubmit={handleAddStudent} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label
                    htmlFor="new-student-absen"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    No. Absen
                  </label>
                  <input
                    id="new-student-absen"
                    type="text"
                    required
                    placeholder="Contoh: 03"
                    value={noAbsen}
                    onChange={(e) => setNoAbsen(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-student-name"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Nama Lengkap
                  </label>
                  <input
                    id="new-student-name"
                    type="text"
                    required
                    placeholder="Contoh: Budi Santoso"
                    value={namaLengkap}
                    onChange={(e) => setNamaLengkap(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-student-pin"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    PIN Login
                  </label>
                  <input
                    id="new-student-pin"
                    type="text"
                    required
                    placeholder="Contoh: 1234"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-student-kelas"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Kelas (Opsional)
                  </label>
                  <input
                    id="new-student-kelas"
                    type="text"
                    placeholder="Contoh: Kelas 5A"
                    value={kelas}
                    onChange={(e) => setKelas(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors min-h-[40px]"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Tambah Siswa</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : mode === 'bulk' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="bulk-students-textarea"
                  className="text-xs font-medium text-slate-700"
                >
                  Tempel daftar siswa (format: No Absen, Nama Lengkap, PIN, Kelas — pisahkan koma atau tab Excel)
                </label>
                <span className="text-xs font-mono tabular-nums text-slate-600">
                  {parsedBulk.valid.length} baris valid
                  {parsedBulk.invalidLines.length > 0 &&
                    ` · ${parsedBulk.invalidLines.length} baris tidak lengkap`}
                </span>
              </div>

              <textarea
                id="bulk-students-textarea"
                rows={5}
                placeholder={`01, Ahmad Fauzan, 1234, Kelas 5A\n02, Siti Nurhaliza, 5678, Kelas 5A\n03, Budi Santoso, 2468, Kelas 5A`}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="w-full p-3 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 leading-relaxed"
              />

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Jika No. Absen sudah terdaftar, data akan diperbarui otomatis.
                </p>
                <button
                  type="button"
                  onClick={handleBulkImport}
                  disabled={importing || parsedBulk.valid.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors min-h-[40px] whitespace-nowrap shrink-0"
                >
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Mengimpor...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Impor {parsedBulk.valid.length} Siswa</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleFileDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  isDraggingFile
                    ? 'border-teal-600 bg-teal-50/70'
                    : 'border-slate-300 bg-slate-50/70 hover:border-teal-500'
                }`}
              >
                <input
                  ref={fileInputRef}
                  id="student-ai-file-input"
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
                  onChange={handleFileInputChange}
                  className="sr-only"
                />

                <div className="mx-auto w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center mb-3">
                  {extractingFile ? (
                    <Loader2 className="w-5 h-5 text-teal-700 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-5 h-5 text-teal-700" />
                  )}
                </div>

                <h3 className="text-sm font-semibold text-slate-900">
                  {extractingFile
                    ? `Membaca "${selectedFileName}" dengan Gemini AI...`
                    : 'Unggah Daftar Absen Siswa (CSV, Excel, PDF, atau Foto)'}
                </h3>
                <p className="mt-1 text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
                  Gemini AI akan mengekstrak No. Absen, Nama Lengkap, serta
                  Kelas, lalu otomatis membuatkan PIN login 4 digit unik untuk
                  setiap siswa jika file belum memiliki kolom PIN.
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  <label
                    htmlFor="student-ai-file-input"
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors min-h-[40px] cursor-pointer ${
                      extractingFile ? 'opacity-60 pointer-events-none' : ''
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    <span>Pilih File dari Perangkat</span>
                  </label>
                  {selectedFileName && !extractingFile && (
                    <span className="text-xs font-mono text-slate-600">
                      File terakhir: {selectedFileName}
                    </span>
                  )}
                </div>
              </div>

              {previewStudents.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Pratinjau Hasil Ekstraksi AI ({previewStudents.length}{' '}
                        siswa)
                      </h4>
                      <p className="text-xs text-slate-600">
                        Guru dapat mengedit langsung kolom di bawah sebelum
                        menyimpan ke database Supabase.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadPinCsv(
                            previewStudents,
                            'daftar-pin-siswa-sdn-nguling-3.csv',
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap min-h-[38px]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh Daftar PIN Siswa (CSV)</span>
                      </button>
                      <button
                        type="button"
                        disabled={savingPreview}
                        onClick={handleSavePreviewToDatabase}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap min-h-[38px]"
                      >
                        {savingPreview ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Menyimpan...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Simpan Semua ke Database</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                        <tr>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                            No. Absen
                          </th>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-600">
                            Nama Lengkap
                          </th>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                            Kelas
                          </th>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                            PIN Login (4 Digit)
                          </th>
                          <th className="py-2 px-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                            Hapus
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs bg-white">
                        {previewStudents.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-1.5 px-2.5">
                              <input
                                type="text"
                                aria-label={`Pratinjau No Absen baris ${idx + 1}`}
                                value={row.no_absen}
                                onChange={(e) =>
                                  handlePreviewFieldChange(
                                    idx,
                                    'no_absen',
                                    e.target.value,
                                  )
                                }
                                className="w-16 px-2 py-1 font-mono tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-700"
                              />
                            </td>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="text"
                                aria-label={`Pratinjau Nama Lengkap baris ${idx + 1}`}
                                value={row.nama_lengkap}
                                onChange={(e) =>
                                  handlePreviewFieldChange(
                                    idx,
                                    'nama_lengkap',
                                    e.target.value,
                                  )
                                }
                                className="w-full min-w-[160px] px-2 py-1 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-700"
                              />
                            </td>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="text"
                                aria-label={`Pratinjau Kelas baris ${idx + 1}`}
                                placeholder="Kelas 5A"
                                value={row.kelas || ''}
                                onChange={(e) =>
                                  handlePreviewFieldChange(
                                    idx,
                                    'kelas',
                                    e.target.value,
                                  )
                                }
                                className="w-24 px-2 py-1 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-700"
                              />
                            </td>
                            <td className="py-1.5 px-2.5">
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="text"
                                  aria-label={`Pratinjau PIN baris ${idx + 1}`}
                                  value={row.pin}
                                  onChange={(e) =>
                                    handlePreviewFieldChange(
                                      idx,
                                      'pin',
                                      e.target.value,
                                    )
                                  }
                                  className="w-20 px-2 py-1 font-mono tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-700"
                                />
                                <button
                                  type="button"
                                  title="Buat ulang PIN 4 digit unik"
                                  aria-label={`Acak ulang PIN baris ${idx + 1}`}
                                  onClick={() => handleRegeneratePreviewPin(idx)}
                                  className="p-1 text-slate-500 hover:text-teal-700 hover:bg-teal-50 rounded"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="py-1.5 px-2.5 text-right">
                              <button
                                type="button"
                                aria-label={`Hapus baris pratinjau ${idx + 1}`}
                                onClick={() => handleRemovePreviewRow(idx)}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {formFeedback && (
            <div
              role="status"
              className="flex items-start gap-2 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3.5 py-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <span>{formFeedback}</span>
            </div>
          )}

          <div className="border-t border-slate-200 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Daftar Siswa Terdaftar
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {students.length} siswa
                </span>
              </div>
              {students.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadPinCsv(
                      students,
                      'daftar-pin-siswa-sdn-nguling-3.csv',
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Daftar PIN Siswa (CSV)</span>
                </button>
              )}
            </div>

            {loading ? (
              <div className="space-y-2">
                <div className="h-10 bg-slate-100 rounded animate-pulse" />
                <div className="h-10 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : students.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                Belum ada data siswa di tabel students.
              </p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        No. Absen
                      </th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600">
                        Nama Lengkap
                      </th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        PIN
                      </th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600">
                        Kelas
                      </th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {students.map((s) => {
                      const isEditing = String(editingId) === String(s.id);
                      const isConfirmingDelete =
                        String(confirmDeleteId) === String(s.id);

                      if (isEditing) {
                        return (
                          <tr key={String(s.id)} className="bg-teal-50/40">
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                aria-label="Edit No. Absen"
                                value={editNoAbsen}
                                onChange={(e) => setEditNoAbsen(e.target.value)}
                                className="w-20 px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                aria-label="Edit Nama Lengkap"
                                value={editNamaLengkap}
                                onChange={(e) =>
                                  setEditNamaLengkap(e.target.value)
                                }
                                className="w-full min-w-[140px] px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                aria-label="Edit PIN"
                                value={editPin}
                                onChange={(e) => setEditPin(e.target.value)}
                                className="w-20 px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                aria-label="Edit Kelas"
                                value={editKelas}
                                onChange={(e) => setEditKelas(e.target.value)}
                                className="w-24 px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={savingEdit}
                                  onClick={() => handleSaveEdit(s.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Simpan</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded"
                                >
                                  Batal
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={String(s.id)} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                            {String(s.no_absen)}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            {s.nama_lengkap}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {s.pin || '••••'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">
                            {s.kelas || '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            {isConfirmingDelete ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={deletingId === s.id}
                                  onClick={() => handleDeleteStudent(s)}
                                  className="px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
                                >
                                  Hapus
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  aria-label={`Edit ${s.nama_lengkap}`}
                                  onClick={() => startEdit(s)}
                                  className="p-1.5 text-slate-500 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Hapus ${s.nama_lengkap}`}
                                  onClick={() => setConfirmDeleteId(s.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
