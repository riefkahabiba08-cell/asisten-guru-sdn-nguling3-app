import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Globe,
  Loader2,
  Printer,
  Scissors,
  X,
} from 'lucide-react';
import { fetchStudentsData } from '../lib/dataService';
import type { Student } from '../types';

interface StudentLoginCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStudents?: Student[];
}

const CARDS_PER_A4_PAGE = 8;
const WEBSITE_ADDRESS = 'asisten-guru-sdn-nguling3-app.vercel.app';

export function StudentLoginCardsModal({
  isOpen,
  onClose,
  initialStudents = [],
}: StudentLoginCardsModalProps) {
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKelas, setSelectedKelas] = useState<string>('all');

  useEffect(() => {
    if (!isOpen) return;

    if (initialStudents.length > 0) {
      setStudents(initialStudents);
    }

    let active = true;
    setLoading(true);
    setError(null);
    fetchStudentsData()
      .then((res) => {
        if (!active) return;
        if (res.ok && res.data) {
          setStudents(res.data);
        } else if (initialStudents.length === 0) {
          setError(res.error || 'Gagal memuat daftar siswa untuk dicetak.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, initialStudents]);

  const classOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const s of students) {
      const k = String(s.kelas ?? '').trim();
      if (k) unique.add(k);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'id'));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const list =
      selectedKelas === 'all'
        ? students
        : students.filter(
            (s) => String(s.kelas ?? '').trim() === selectedKelas,
          );
    return [...list].sort((a, b) => {
      const na = Number(a.no_absen);
      const nb = Number(b.no_absen);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) {
        return na - nb;
      }
      return String(a.no_absen).localeCompare(String(b.no_absen), 'id');
    });
  }, [students, selectedKelas]);

  const pagedStudents = useMemo(() => {
    const pages: Student[][] = [];
    for (let i = 0; i < filteredStudents.length; i += CARDS_PER_A4_PAGE) {
      pages.push(filteredStudents.slice(i, i + CARDS_PER_A4_PAGE));
    }
    return pages;
  }, [filteredStudents]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-cards-modal-title"
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex flex-col overflow-hidden print:static print:inset-auto print:bg-white print:backdrop-blur-none print:overflow-visible print:block"
    >
      {/* Toolbar Pratinjau Cetak (disembunyikan saat print/PDF) */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
        <div className="min-w-0">
          <h2
            id="print-cards-modal-title"
            className="text-base sm:text-lg font-bold text-slate-900"
          >
            Pratinjau Cetak Kartu Login Siswa (A4)
          </h2>
          <p className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono tabular-nums">
              {filteredStudents.length} kartu · {pagedStudents.length || 1}{' '}
              halaman A4
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Scissors className="w-3.5 h-3.5 text-slate-500" />
              <span>Tata letak 2 kolom dengan garis putus-putus pembatas potong</span>
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {classOptions.length > 0 && (
            <select
              aria-label="Filter kelas untuk kartu login"
              value={selectedKelas}
              onChange={(e) => setSelectedKelas(e.target.value)}
              className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 min-h-[40px]"
            >
              <option value="all">Semua Kelas ({students.length})</option>
              {classOptions.map((kelas) => (
                <option key={kelas} value={kelas}>
                  {kelas}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={filteredStudents.length === 0}
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Simpan sebagai PDF</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau cetak kartu login"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-h-[40px]"
          >
            <X className="w-4 h-4" />
            <span>Tutup</span>
          </button>
        </div>
      </div>

      {/* Area Kanvas Pratinjau Lembar A4 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 bg-slate-200/80 print:bg-white print:p-0 print:space-y-0 print:overflow-visible">
        {loading && students.length === 0 ? (
          <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-8 text-center print:hidden">
            <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Menyiapkan kartu login siswa...
            </p>
          </div>
        ) : error && filteredStudents.length === 0 ? (
          <div
            role="alert"
            className="max-w-lg mx-auto bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-2.5 text-sm text-red-800 print:hidden"
          >
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-xl p-8 text-center print:hidden">
            <p className="text-sm font-semibold text-slate-800">
              Belum ada data siswa untuk dicetak
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Tambahkan atau impor data siswa terlebih dahulu melalui menu
              Kelola Data Siswa.
            </p>
          </div>
        ) : (
          pagedStudents.map((pageCards, pageIndex) => (
            <div key={pageIndex} className="space-y-2 print:space-y-0">
              <div className="max-w-[210mm] mx-auto flex items-center justify-between text-xs font-medium text-slate-600 px-1 print:hidden">
                <span>
                  Halaman A4 {pageIndex + 1} dari {pagedStudents.length}
                </span>
                <span className="font-mono tabular-nums">
                  {pageCards.length} kartu pada halaman ini
                </span>
              </div>

              {/* Lembar Kertas A4 (210mm x min-297mm pada pratinjau layar) */}
              <section
                aria-label={`Halaman Kartu Login ${pageIndex + 1}`}
                className="max-w-[210mm] mx-auto bg-white shadow-md border border-slate-300 p-5 sm:p-[8mm] print:shadow-none print:border-none print:p-0 print:max-w-none print:w-full break-after-page last:break-after-auto"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-3.5 print:gap-3">
                  {pageCards.map((s) => (
                    <article
                      key={String(s.id)}
                      className="border-2 border-dashed border-slate-400 rounded-xl p-1.5 bg-white break-inside-avoid print:border-slate-500"
                    >
                      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white flex flex-col">
                        {/* Header Bertema Pendidikan Warna Teal/Emerald */}
                        <div className="bg-gradient-to-r from-teal-700 to-emerald-700 text-white px-3.5 py-2.5 flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                            <BookOpen className="w-3.5 h-3.5 text-white" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-bold tracking-wide leading-tight uppercase">
                              KARTU LOGIN PORTAL SISWA — SDN NGULING 3
                            </div>
                          </div>
                        </div>

                        {/* Isi Identitas & Sorotan Nomor Absen + PIN */}
                        <div className="p-3.5 space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Nama Lengkap
                              </div>
                              <div className="mt-0.5 text-sm sm:text-base font-bold text-slate-900 leading-snug truncate">
                                {s.nama_lengkap}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Kelas
                              </div>
                              <div className="mt-0.5 text-xs sm:text-sm font-semibold text-teal-800">
                                {s.kelas || '—'}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="bg-teal-50/90 border border-teal-200 rounded-lg px-2.5 py-2 text-center">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-800">
                                Nomor Absen
                              </div>
                              <div className="mt-0.5 text-xl sm:text-2xl font-bold font-mono tabular-nums text-teal-950 leading-none">
                                {String(s.no_absen)}
                              </div>
                            </div>

                            <div className="bg-emerald-50/90 border border-emerald-200 rounded-lg px-2.5 py-2 text-center">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                                PIN Login
                              </div>
                              <div className="mt-0.5 text-xl sm:text-2xl font-bold font-mono tabular-nums tracking-widest text-emerald-950 leading-none">
                                {s.pin || '••••'}
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 text-[10px] text-slate-600">
                            <span className="inline-flex items-center gap-1 font-mono text-slate-700 truncate">
                              <Globe className="w-3 h-3 text-teal-700 shrink-0" />
                              <span className="truncate">{WEBSITE_ADDRESS}</span>
                            </span>
                            <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap shrink-0">
                              Simpan baik-baik
                            </span>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
