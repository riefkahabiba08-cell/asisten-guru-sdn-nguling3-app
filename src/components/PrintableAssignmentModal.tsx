import { useMemo } from 'react';
import { FileText, Printer, X } from 'lucide-react';
import { parseInstruksiSoal } from './PortalSiswa';
import type { Assignment } from '../types';

interface PrintableAssignmentModalProps {
  assignment: Assignment | null;
  onClose: () => void;
}

function hasExistingAnswerBlank(text: string): boolean {
  return /(\.{3,}|_{3,}|…)/.test(text);
}

export function PrintableAssignmentModal({
  assignment,
  onClose,
}: PrintableAssignmentModalProps) {
  const parsed = useMemo(
    () =>
      assignment
        ? parseInstruksiSoal(assignment.instruksi_soal)
        : { intro: '', questions: [] },
    [assignment],
  );

  if (!assignment) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="printable-assignment-title"
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex flex-col overflow-hidden print:static print:inset-auto print:bg-white print:backdrop-blur-none print:overflow-visible print:block"
    >
      {/* Toolbar Pratinjau Cetak (disembunyikan saat print/PDF) */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
        <div className="min-w-0">
          <h2
            id="printable-assignment-title"
            className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2"
          >
            <FileText className="w-4 h-4 text-teal-700 shrink-0" />
            <span>Pratinjau Cetak Lembar Soal (A4)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5 truncate max-w-2xl">
            {assignment.judul} · Kunci jawaban &amp; rubrik otomatis
            disembunyikan pada lembar cetak siswa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Simpan sebagai PDF</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau cetak lembar soal"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-h-[40px]"
          >
            <X className="w-4 h-4" />
            <span>Tutup</span>
          </button>
        </div>
      </div>

      {/* Area Kanvas Lembar Kertas A4 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-200/80 print:bg-white print:p-0 print:overflow-visible">
        <article
          aria-label="Lembar Soal Siap Cetak A4"
          className="max-w-[210mm] min-h-[297mm] mx-auto bg-white shadow-md border border-slate-300 p-6 sm:p-[12mm] print:shadow-none print:border-none print:p-0 print:max-w-none print:min-h-0 print:w-full text-slate-900"
        >
          {/* Kop Surat Resmi SD */}
          <header className="text-center border-b-4 border-double border-slate-900 pb-3 mb-4">
            <p className="text-xs sm:text-sm font-semibold tracking-wider uppercase text-slate-800">
              PEMERINTAH KABUPATEN PASURUAN · DINAS PENDIDIKAN
            </p>
            <h1 className="mt-0.5 text-base sm:text-lg font-bold tracking-wide uppercase text-slate-950">
              UPT SATUAN PENDIDIKAN SDN NGULING 3
            </h1>
          </header>

          {/* Judul Tugas / Lembar Soal */}
          <div className="text-center mb-4">
            <h2 className="text-sm sm:text-base font-bold uppercase tracking-tight text-slate-950">
              {assignment.judul}
            </h2>
          </div>

          {/* Kotak Identitas Siswa & Kotak Nilai */}
          <section
            aria-label="Identitas Siswa dan Kotak Nilai"
            className="border border-slate-800 rounded-md p-3 mb-5 grid grid-cols-12 gap-3 items-stretch"
          >
            <div className="col-span-9 sm:col-span-10 space-y-2 text-xs sm:text-sm">
              <div className="flex items-end gap-2">
                <span className="font-semibold w-28 shrink-0">
                  Nama Lengkap
                </span>
                <span>:</span>
                <span
                  aria-hidden="true"
                  className="flex-1 border-b border-dotted border-slate-700 h-4"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                <div className="flex items-end gap-2">
                  <span className="font-semibold w-28 sm:w-14 shrink-0">
                    Kelas
                  </span>
                  <span>:</span>
                  <span
                    aria-hidden="true"
                    className="flex-1 border-b border-dotted border-slate-700 h-4"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <span className="font-semibold w-28 sm:w-20 shrink-0">
                    No. Absen
                  </span>
                  <span>:</span>
                  <span
                    aria-hidden="true"
                    className="flex-1 border-b border-dotted border-slate-700 h-4"
                  />
                </div>
              </div>
            </div>

            <div className="col-span-3 sm:col-span-2 border border-slate-800 rounded flex flex-col items-center justify-between py-1.5 px-2 min-h-[62px]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-800 border-b border-slate-300 w-full text-center pb-0.5">
                Nilai
              </span>
              <span className="flex-1 w-full" aria-hidden="true" />
            </div>
          </section>

          {/* Petunjuk Pengerjaan Umum */}
          {parsed.intro && (
            <div className="mb-4 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-md text-xs sm:text-sm text-slate-800 whitespace-pre-line leading-relaxed print:bg-transparent">
              {parsed.intro}
            </div>
          )}

          {/* Daftar Soal Siap Cetak */}
          {parsed.questions.length > 0 ? (
            <div className="space-y-4">
              {parsed.questions.map((q, idx) => {
                const needsAnswerLines =
                  q.type === 'essay' && !hasExistingAnswerBlank(q.prompt);

                return (
                  <div
                    key={`${q.number}-${idx}`}
                    className="break-inside-avoid space-y-2"
                  >
                    {q.sectionHeading && (
                      <div className="pt-2 pb-1 border-b border-slate-400 text-xs sm:text-sm font-bold uppercase tracking-wide text-slate-900">
                        {q.sectionHeading}
                      </div>
                    )}

                    <div className="flex items-start gap-2.5 text-sm text-slate-950">
                      <span className="font-mono font-bold tabular-nums w-6 shrink-0 pt-0.5">
                        {q.number}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="whitespace-pre-line leading-relaxed">
                          {q.prompt}
                        </p>

                        {q.type === 'multiple_choice' ? (
                          <div className="mt-2 space-y-1.5 pl-1">
                            {q.options.map((opt) => (
                              <div
                                key={opt.label}
                                className="flex items-start gap-2 text-sm leading-snug"
                              >
                                <span className="font-semibold w-5 shrink-0">
                                  {opt.label}.
                                </span>
                                <span className="flex-1">{opt.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          needsAnswerLines && (
                            <div
                              aria-hidden="true"
                              className="mt-2.5 space-y-3 pt-1"
                            >
                              <div className="flex items-end gap-2">
                                <span className="text-xs font-medium text-slate-600 shrink-0">
                                  Jawab:
                                </span>
                                <span className="flex-1 border-b border-dotted border-slate-600 h-4" />
                              </div>
                              <div className="border-b border-dotted border-slate-600 h-4 w-full" />
                              <div className="border-b border-dotted border-slate-600 h-4 w-full" />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-slate-950 whitespace-pre-line leading-relaxed">
                {assignment.instruksi_soal}
              </div>
              {!hasExistingAnswerBlank(assignment.instruksi_soal) && (
                <div aria-hidden="true" className="pt-2 space-y-4">
                  <div className="text-xs font-semibold text-slate-700">
                    Jawaban:
                  </div>
                  <div className="border-b border-dotted border-slate-600 h-5 w-full" />
                  <div className="border-b border-dotted border-slate-600 h-5 w-full" />
                  <div className="border-b border-dotted border-slate-600 h-5 w-full" />
                  <div className="border-b border-dotted border-slate-600 h-5 w-full" />
                  <div className="border-b border-dotted border-slate-600 h-5 w-full" />
                </div>
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
