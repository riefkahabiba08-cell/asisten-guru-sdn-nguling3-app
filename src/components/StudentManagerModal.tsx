import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus, X } from 'lucide-react';
import type { Student } from '../types';

interface StudentManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStudentsChanged: () => void;
}

export function StudentManagerModal({
  isOpen,
  onClose,
  onStudentsChanged,
}: StudentManagerModalProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [noAbsen, setNoAbsen] = useState('');
  const [namaLengkap, setNamaLengkap] = useState('');
  const [pin, setPin] = useState('');
  const [kelas, setKelas] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<string | null>(null);

  const fetchStudents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/students');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal memuat daftar siswa.');
        setStudents([]);
      } else {
        setStudents(data.students || []);
      }
    } catch {
      setError('Tidak dapat terhubung ke server untuk memuat data siswa.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStudents();
      setFormFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFormFeedback(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          no_absen: noAbsen.trim(),
          nama_lengkap: namaLengkap.trim(),
          pin: pin.trim(),
          kelas: kelas.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal menambahkan data siswa.');
      } else {
        setNoAbsen('');
        setNamaLengkap('');
        setPin('');
        setKelas('');
        setFormFeedback(
          `Siswa "${data.student.nama_lengkap}" berhasil ditambahkan.`,
        );
        await fetchStudents();
        onStudentsChanged();
      }
    } catch {
      setError('Terjadi gangguan jaringan saat menyimpan data siswa.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2
              id="student-manager-title"
              className="text-lg font-semibold text-slate-900"
            >
              Kelola Data Siswa SDN Nguling 3
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Tambahkan nomor absen, nama lengkap, dan PIN login untuk Portal Siswa.
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
          <form onSubmit={handleAddStudent} className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Tambah Siswa Baru
            </h3>
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
              <div className="sm:col-span-2 lg:col-span-1">
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
                  placeholder="Contoh: 5A"
                  value={kelas}
                  onChange={(e) => setKelas(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[40px]"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {formFeedback && (
              <p className="text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                {formFeedback}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors min-h-[40px]"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'Menyimpan...' : 'Tambah Siswa'}</span>
              </button>
            </div>
          </form>

          <div className="border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Daftar Siswa Terdaftar
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {students.length} siswa
              </span>
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
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600">
                        No. Absen
                      </th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600">
                        Nama Siswa
                      </th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-slate-600">
                        Kelas
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {students.map((s) => (
                      <tr key={String(s.id)} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700">
                          {String(s.no_absen)}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {s.nama_lengkap}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {s.kelas || '—'}
                        </td>
                      </tr>
                    ))}
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
