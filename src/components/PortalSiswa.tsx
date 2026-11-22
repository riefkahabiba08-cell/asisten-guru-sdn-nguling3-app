import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Send,
} from 'lucide-react';
import {
  fetchStudentWorkspaceData,
  gradeAndSubmitAnswerData,
  loginStudentData,
} from '../lib/dataService';
import type { Assignment, Student, Submission } from '../types';

interface PortalSiswaProps {
  student: Student | null;
  onLoginSuccess: (student: Student) => void;
  onTableMissing: (message: string) => void;
}

export interface QuestionOption {
  label: string;
  text: string;
}

export interface ParsedQuestion {
  number: string;
  sectionHeading?: string;
  prompt: string;
  type: 'multiple_choice' | 'essay';
  options: QuestionOption[];
}

export interface ParsedAssignmentContent {
  intro: string;
  questions: ParsedQuestion[];
}

const HERO_IMAGE_PATH = '/src/assets/images/classroom_desk_sdn_1795323626915.jpg';

function isSectionHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^(bagian\s+[a-z0-9]+|soal\s+(pilihan\s+ganda|isian|uraian|esai)|[a-d]\.\s+(?:soal\s+)?(pilihan\s+ganda|isian(?:\s+singkat)?|uraian|esai)\b|[ivx]{1,4}\.\s+[a-z])/i.test(
    trimmed,
  );
}

function splitInlineOptionsIfPresent(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const hasInlineChain =
      /(?:^|\s)A[.)]\s+.+\s+B[.)]\s+/i.test(trimmed) ||
      (/^[A-D][.)]\s+/i.test(trimmed) && /\s+[B-D][.)]\s+/i.test(trimmed));

    if (hasInlineChain) {
      const splitLines = trimmed
        .replace(/\s+(?=[A-D][.)]\s+)/g, '\n')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      result.push(...splitLines);
    } else {
      result.push(line);
    }
  }
  return result;
}

export function parseInstruksiSoal(rawText: string): ParsedAssignmentContent {
  const normalized = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (!normalized) {
    return { intro: '', questions: [] };
  }

  let rawLines = normalized.split('\n');

  // Jika soal bernomor 1., 2., dst. masih menyatu dalam satu baris panjang, pecah terlebih dahulu
  const lineStartNumberCount = rawLines.filter((l) =>
    /^\s*\d{1,2}\.\s+/.test(l),
  ).length;
  if (
    lineStartNumberCount < 2 &&
    /(?:^|\s)1\.\s+/.test(normalized) &&
    /\s2\.\s+/.test(normalized)
  ) {
    rawLines = normalized
      .replace(/\s+(?=\b([1-9]|[12]\d)\.\s+)/g, '\n')
      .split('\n');
  }

  const introLines: string[] = [];
  const rawBlocks: Array<{
    number: string;
    sectionHeading?: string;
    bodyLines: string[];
  }> = [];

  let currentBlock: {
    number: string;
    sectionHeading?: string;
    bodyLines: string[];
  } | null = null;
  let lastQuestionNum = 0;
  let pendingSectionHeading: string | undefined;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    const numMatch = trimmed.match(/^(\d{1,2})\.\s+(.+)$/);

    if (numMatch) {
      const num = Number(numMatch[1]);
      const isValidSequence =
        rawBlocks.length === 0
          ? num === 1
          : num > lastQuestionNum && num <= lastQuestionNum + 5;

      if (isValidSequence) {
        if (currentBlock) {
          rawBlocks.push(currentBlock);
        }
        currentBlock = {
          number: numMatch[1],
          sectionHeading: pendingSectionHeading,
          bodyLines: [numMatch[2].trim()],
        };
        pendingSectionHeading = undefined;
        lastQuestionNum = num;
        continue;
      }
    }

    if (!currentBlock) {
      introLines.push(rawLine);
    } else if (isSectionHeaderLine(trimmed)) {
      pendingSectionHeading = trimmed;
    } else {
      currentBlock.bodyLines.push(rawLine);
    }
  }

  if (currentBlock) {
    rawBlocks.push(currentBlock);
  }

  // Jika tidak ditemukan struktur soal bernomor, kembalikan sebagai tugas teks bebas
  if (rawBlocks.length === 0) {
    return {
      intro: normalized,
      questions: [],
    };
  }

  const questions: ParsedQuestion[] = rawBlocks.map((block) => {
    const expandedLines = splitInlineOptionsIfPresent(block.bodyLines);
    const promptLines: string[] = [];
    const options: QuestionOption[] = [];
    let currentOption: QuestionOption | null = null;

    for (const line of expandedLines) {
      const trimmed = line.trim();
      const optMatch = trimmed.match(/^([A-Da-d])[.)]\s+(.+)$/);

      if (optMatch) {
        const label = optMatch[1].toUpperCase();
        const optText = optMatch[2].trim();
        const isFirstOption = options.length === 0 && label === 'A';
        const isFollowingOption =
          options.length > 0 &&
          label.charCodeAt(0) > options[options.length - 1].label.charCodeAt(0) &&
          label.charCodeAt(0) <= 68;

        if (isFirstOption || isFollowingOption) {
          currentOption = { label, text: optText };
          options.push(currentOption);
          continue;
        }
      }

      if (currentOption) {
        if (trimmed) {
          currentOption.text = `${currentOption.text} ${trimmed}`.trim();
        }
      } else {
        promptLines.push(line);
      }
    }

    const isMultipleChoice =
      options.length >= 2 && options.some((opt) => opt.label === 'A');

    return {
      number: block.number,
      sectionHeading: block.sectionHeading,
      prompt: promptLines.join('\n').trim(),
      type: isMultipleChoice ? 'multiple_choice' : 'essay',
      options: isMultipleChoice ? options : [],
    };
  });

  return {
    intro: introLines.join('\n').trim(),
    questions,
  };
}

export function PortalSiswa({
  student,
  onLoginSuccess,
  onTableMissing,
}: PortalSiswaProps) {
  const [noAbsen, setNoAbsen] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<
    string | number | null
  >(null);
  const [jawabanTeks, setJawabanTeks] = useState('');
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>(
    {},
  );
  const [grading, setGrading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<Submission | null>(null);

  const loadWorkspaceData = useCallback(
    async (studentId: string | number) => {
      setLoadingWorkspace(true);
      setWorkspaceError(null);
      try {
        const res = await fetchStudentWorkspaceData(studentId);
        if (!res.ok || !res.data) {
          if (res.code === 'TABLE_MISSING' && res.error) {
            onTableMissing(res.error);
          }
          setWorkspaceError(res.error || 'Gagal memuat daftar tugas.');
          return;
        }

        const loadedAssignments = res.data.assignments;
        setAssignments(loadedAssignments);
        setSubmissions(res.data.submissions);

        if (loadedAssignments.length > 0) {
          setSelectedAssignmentId((prev) => {
            const exists = loadedAssignments.some(
              (a) => String(a.id) === String(prev),
            );
            return exists ? prev : loadedAssignments[0].id;
          });
        } else {
          setSelectedAssignmentId(null);
        }
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [onTableMissing],
  );

  useEffect(() => {
    if (student) {
      loadWorkspaceData(student.id);
    } else {
      setAssignments([]);
      setSubmissions([]);
      setSelectedAssignmentId(null);
      setJawabanTeks('');
      setQuestionAnswers({});
      setLatestResult(null);
      setSubmitError(null);
    }
  }, [student, loadWorkspaceData]);

  const submissionByAssignment = useMemo(() => {
    const map = new Map<string, Submission>();
    for (const sub of submissions) {
      const key = String(sub.assignment_id);
      if (!map.has(key)) {
        map.set(key, sub);
      }
    }
    return map;
  }, [submissions]);

  const activeAssignment = useMemo(
    () =>
      assignments.find((a) => String(a.id) === String(selectedAssignmentId)) ||
      null,
    [assignments, selectedAssignmentId],
  );

  const parsedAssignment = useMemo(
    () =>
      activeAssignment
        ? parseInstruksiSoal(activeAssignment.instruksi_soal)
        : { intro: '', questions: [] },
    [activeAssignment],
  );

  const totalQuestions = parsedAssignment.questions.length;
  const answeredCount = useMemo(() => {
    if (totalQuestions === 0) return 0;
    return parsedAssignment.questions.reduce((acc, _q, idx) => {
      const val = (questionAnswers[idx] || '').trim();
      return val ? acc + 1 : acc;
    }, 0);
  }, [parsedAssignment.questions, questionAnswers, totalQuestions]);

  const activeSubmission = useMemo(() => {
    if (!activeAssignment) return null;
    if (
      latestResult &&
      String(latestResult.assignment_id) === String(activeAssignment.id)
    ) {
      return latestResult;
    }
    return submissionByAssignment.get(String(activeAssignment.id)) || null;
  }, [activeAssignment, latestResult, submissionByAssignment]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await loginStudentData(noAbsen.trim(), pin.trim());
      if (!res.ok || !res.data) {
        if (res.code === 'TABLE_MISSING' && res.error) {
          onTableMissing(res.error);
        }
        setLoginError(res.error || 'Gagal masuk ke Portal Siswa.');
        return;
      }
      setPin('');
      onLoginSuccess(res.data);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSelectAssignment = (assignment: Assignment) => {
    setSelectedAssignmentId(assignment.id);
    setJawabanTeks('');
    setQuestionAnswers({});
    setSubmitError(null);
    setLatestResult(null);
  };

  const handleSelectOption = (questionIndex: number, optionLabel: string) => {
    setQuestionAnswers((prev) => ({
      ...prev,
      [questionIndex]: optionLabel,
    }));
    if (submitError) setSubmitError(null);
  };

  const handleTextAnswerChange = (questionIndex: number, value: string) => {
    setQuestionAnswers((prev) => ({
      ...prev,
      [questionIndex]: value,
    }));
    if (submitError) setSubmitError(null);
  };

  const handleGradeAndSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!student || !activeAssignment) return;

    let finalAnswerText = '';

    if (totalQuestions > 0) {
      if (answeredCount === 0) {
        setSubmitError(
          'Silakan pilih atau tuliskan minimal satu jawaban sebelum mengirim.',
        );
        return;
      }

      const combinedLines = parsedAssignment.questions.map((q, idx) => {
        const rawVal = (questionAnswers[idx] || '').trim();
        if (q.type === 'multiple_choice') {
          const chosen = q.options.find((opt) => opt.label === rawVal);
          if (chosen) {
            return `${q.number}. ${chosen.label}. ${chosen.text}`;
          }
          return `${q.number}. (Tidak dijawab)`;
        }
        return `${q.number}. ${rawVal || '(Tidak dijawab)'}`;
      });
      finalAnswerText = combinedLines.join('\n');
    } else {
      const trimmed = jawabanTeks.trim();
      if (!trimmed) {
        setSubmitError(
          'Silakan tulis jawaban Anda terlebih dahulu sebelum mengirim.',
        );
        return;
      }
      finalAnswerText = trimmed;
    }

    setSubmitError(null);
    setGrading(true);

    try {
      const res = await gradeAndSubmitAnswerData({
        student,
        assignment: activeAssignment,
        jawaban_teks: finalAnswerText,
      });

      if (!res.ok || !res.data) {
        if (res.code === 'TABLE_MISSING' && res.error) {
          onTableMissing(res.error);
        }
        setSubmitError(res.error || 'Gagal mengoreksi dan menyimpan jawaban.');
        return;
      }

      const savedSub = res.data;
      setLatestResult(savedSub);
      setSubmissions((prev) => [savedSub, ...prev]);
      setJawabanTeks('');
      setQuestionAnswers({});
    } finally {
      setGrading(false);
    }
  };

  if (!student) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-7 relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 min-h-[300px] lg:min-h-[480px]">
            {!imgFailed ? (
              <img
                src={HERO_IMAGE_PATH}
                alt="Meja belajar siswa SD dengan buku tulis dan pensil di ruang kelas SDN Nguling 3"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-teal-900 via-slate-900 to-slate-800 flex items-center justify-center p-8">
                <BookOpen className="w-16 h-16 text-teal-300/60" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent flex flex-col justify-end p-6 sm:p-8">
              <p className="text-xs font-medium text-teal-200 tracking-wide">
                SDN Nguling 3 · Pembelajaran Mandiri
              </p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-white leading-tight [text-wrap:balance]">
                Portal Tugas & Umpan Balik Belajar Siswa
              </h1>
              <p className="mt-2 text-sm text-slate-200 max-w-xl leading-relaxed">
                Pilih tugas dari Bapak/Ibu Guru, tuliskan jawaban terbaikmu, dan
                dapatkan nilai serta saran perbaikan secara langsung.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-center">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Masuk ke Portal Siswa
              </h2>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Gunakan Nomor Absen dan PIN yang telah dibagikan oleh guru kelas.
              </p>
            </div>

            <form onSubmit={handleLogin} className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="login-no-absen"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Nomor Absen
                </label>
                <input
                  id="login-no-absen"
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="Contoh: 01"
                  value={noAbsen}
                  onChange={(e) => setNoAbsen(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-base font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[44px]"
                />
              </div>

              <div>
                <label
                  htmlFor="login-pin"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  PIN Siswa
                </label>
                <div className="relative">
                  <input
                    id="login-pin"
                    type={showPin ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Masukkan PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full pl-3.5 pr-11 py-2.5 text-base font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800 rounded-md"
                  >
                    {showPin ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3.5 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg"
                >
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
              >
                {loginLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memeriksa Data...</span>
                  </>
                ) : (
                  <span>Masuk Portal Siswa</span>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="pb-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-medium">
            <span className="font-mono tabular-nums">
              No. Absen {String(student.no_absen)}
            </span>
            {student.kelas && (
              <>
                <span aria-hidden="true">·</span>
                <span>{student.kelas}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>SDN Nguling 3</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900">
            Selamat Belajar, {student.nama_lengkap}
          </h1>
        </div>
        <div className="text-sm text-slate-600 font-mono tabular-nums">
          {submissions.length} tugas dikumpulkan
        </div>
      </div>

      {workspaceError && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 p-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl"
        >
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          <span>{workspaceError}</span>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <aside className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Daftar Tugas
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {assignments.length} tugas
            </span>
          </div>

          {loadingWorkspace ? (
            <div className="space-y-3">
              <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
              <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : assignments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
              <p className="text-sm text-slate-600">
                Belum ada tugas yang dibuat oleh guru saat ini.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {assignments.map((assignment) => {
                const isSelected =
                  String(assignment.id) === String(selectedAssignmentId);
                const prevSub = submissionByAssignment.get(
                  String(assignment.id),
                );
                return (
                  <button
                    key={String(assignment.id)}
                    type="button"
                    onClick={() => handleSelectAssignment(assignment)}
                    className={`w-full text-left p-4 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
                      isSelected
                        ? 'bg-teal-50/70 border-teal-700'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs text-slate-500 flex items-center gap-1.5">
                      {prevSub ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                          <span className="text-teal-800 font-medium">
                            Sudah Dikoreksi
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-800">
                            Nilai {prevSub.nilai}
                          </span>
                        </>
                      ) : (
                        <span>Belum Dikerjakan</span>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-sm font-semibold text-slate-900 line-clamp-2">
                      {assignment.judul}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 line-clamp-2 whitespace-pre-line leading-relaxed">
                      {assignment.instruksi_soal}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="lg:col-span-8 space-y-6">
          {!activeAssignment ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
              <h2 className="mt-3 text-base font-semibold text-slate-900">
                Pilih Tugas untuk Mulai Mengerjakan
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Daftar tugas dari Bapak/Ibu Guru tersedia di sebelah kiri.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                <div className="text-xs font-medium text-slate-500">
                  Lembar Kerja Siswa
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-900 [text-wrap:balance]">
                  {activeAssignment.judul}
                </h2>

                {parsedAssignment.intro && (
                  <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm sm:text-base text-slate-800 whitespace-pre-line leading-relaxed">
                    {parsedAssignment.intro}
                  </div>
                )}

                <form onSubmit={handleGradeAndSubmit} className="mt-6 space-y-5">
                  {totalQuestions > 0 ? (
                    <>
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-600">
                            Progres Pengerjaan Soal
                          </span>
                          <span className="text-sm font-mono tabular-nums font-semibold text-teal-800">
                            Terjawab {answeredCount} dari {totalQuestions} soal
                          </span>
                        </div>
                        <progress
                          value={answeredCount}
                          max={totalQuestions}
                          aria-label="Progres pengerjaan soal"
                          className="w-full h-2 rounded-md overflow-hidden appearance-none [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:bg-teal-700 [&::-webkit-progress-value]:transition-all [&::-moz-progress-bar]:bg-teal-700"
                        />
                      </div>

                      <div className="space-y-4">
                        {parsedAssignment.questions.map((q, idx) => {
                          const currentAnswer = questionAnswers[idx] || '';
                          const isAnswered = currentAnswer.trim().length > 0;

                          return (
                            <div key={`${q.number}-${idx}`} className="space-y-2">
                              {q.sectionHeading && (
                                <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                  {q.sectionHeading}
                                </div>
                              )}

                              <div
                                className={`p-5 rounded-xl border transition-colors ${
                                  isAnswered
                                    ? 'bg-white border-teal-300'
                                    : 'bg-white border-slate-200'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="font-mono tabular-nums font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md">
                                      Soal {q.number}
                                    </span>
                                    <span className="font-medium text-slate-500">
                                      {q.type === 'multiple_choice'
                                        ? 'Pilihan Ganda'
                                        : 'Isian / Uraian'}
                                    </span>
                                  </div>

                                  <span
                                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                                      isAnswered
                                        ? 'text-teal-700'
                                        : 'text-slate-400'
                                    }`}
                                  >
                                    {isAnswered ? (
                                      <>
                                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                        <span>Terjawab</span>
                                      </>
                                    ) : (
                                      <span>Belum dijawab</span>
                                    )}
                                  </span>
                                </div>

                                <p className="mt-3 text-sm sm:text-base font-medium text-slate-900 whitespace-pre-line leading-relaxed">
                                  {q.prompt}
                                </p>

                                {q.type === 'multiple_choice' ? (
                                  <div
                                    role="group"
                                    aria-label={`Pilihan jawaban soal ${q.number}`}
                                    className="mt-4 space-y-2.5"
                                  >
                                    {q.options.map((opt) => {
                                      const isSelected =
                                        currentAnswer === opt.label;
                                      return (
                                        <button
                                          key={opt.label}
                                          type="button"
                                          disabled={grading}
                                          aria-pressed={isSelected}
                                          onClick={() =>
                                            handleSelectOption(idx, opt.label)
                                          }
                                          className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-60 ${
                                            isSelected
                                              ? 'bg-teal-50/80 border-teal-700 ring-1 ring-teal-700 text-slate-900'
                                              : 'bg-white border-slate-200 hover:border-teal-400 hover:bg-slate-50 text-slate-800'
                                          }`}
                                        >
                                          <span
                                            className={`w-8 h-8 rounded-lg font-mono font-bold text-sm flex items-center justify-center shrink-0 border transition-colors ${
                                              isSelected
                                                ? 'bg-teal-700 text-white border-teal-700'
                                                : 'bg-slate-100 text-slate-700 border-slate-200'
                                            }`}
                                          >
                                            {opt.label}
                                          </span>
                                          <span className="flex-1 text-sm sm:text-base leading-snug">
                                            {opt.text}
                                          </span>
                                          {isSelected && (
                                            <Check className="w-5 h-5 text-teal-700 shrink-0" />
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="mt-4">
                                    <label
                                      htmlFor={`question-essay-${idx}`}
                                      className="sr-only"
                                    >
                                      Jawaban untuk Soal {q.number}
                                    </label>
                                    <textarea
                                      id={`question-essay-${idx}`}
                                      rows={3}
                                      disabled={grading}
                                      placeholder={`Ketik jawabanmu untuk soal nomor ${q.number}...`}
                                      value={currentAnswer}
                                      onChange={(e) =>
                                        handleTextAnswerChange(
                                          idx,
                                          e.target.value,
                                        )
                                      }
                                      className="w-full p-3.5 text-sm sm:text-base text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 disabled:bg-slate-50 leading-relaxed"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-4 mb-1.5">
                        <label
                          htmlFor="student-answer-input"
                          className="text-sm font-semibold text-slate-900"
                        >
                          Jawaban Teks Anda
                        </label>
                        <span className="text-xs font-mono tabular-nums text-slate-500">
                          {jawabanTeks.length} karakter
                        </span>
                      </div>
                      <textarea
                        id="student-answer-input"
                        rows={6}
                        required
                        disabled={grading}
                        placeholder="Tuliskan jawaban lengkapmu di sini dengan kalimat yang jelas..."
                        value={jawabanTeks}
                        onChange={(e) => setJawabanTeks(e.target.value)}
                        className="w-full p-4 text-base text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 disabled:bg-slate-50 leading-relaxed"
                      />
                    </div>
                  )}

                  {submitError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 p-3.5 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg"
                    >
                      <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="text-xs text-slate-600">
                      {totalQuestions > 0 ? (
                        <span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            Terjawab {answeredCount} dari {totalQuestions} soal
                          </span>{' '}
                          · Seluruh jawaban akan digabung berurutan untuk
                          dikoreksi AI.
                        </span>
                      ) : (
                        <span>
                          Jawaban akan diperiksa otomatis berdasarkan rubrik guru
                          dan disimpan ke rekap nilai.
                        </span>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={
                        grading ||
                        (totalQuestions > 0
                          ? answeredCount === 0
                          : !jawabanTeks.trim())
                      }
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
                    >
                      {grading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Sedang Mengoreksi AI...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>
                            {activeSubmission
                              ? 'Kirim Jawaban Baru'
                              : 'Kirim & Koreksi AI'}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {activeSubmission && (
                <div
                  aria-live="polite"
                  className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
                    <div>
                      <div className="text-xs font-medium text-slate-500">
                        Hasil Koreksi Otomatis
                      </div>
                      <h3 className="mt-1 text-lg font-bold text-slate-900">
                        Penilaian & Umpan Balik Guru AI
                      </h3>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Nilai Akhir</div>
                        <div className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                          {activeSubmission.nilai}
                          <span className="text-base font-normal text-slate-500">
                            /100
                          </span>
                        </div>
                      </div>
                      <div className="h-10 w-px bg-slate-200" aria-hidden="true" />
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        {activeSubmission.nilai >= 75 ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-emerald-700">Tuntas</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-amber-700">Perlu Bimbingan</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 space-y-4">
                    <div>
                      <div className="text-xs font-semibold text-slate-600 mb-1.5">
                        Umpan Balik untuk {student.nama_lengkap}
                      </div>
                      <p className="text-sm sm:text-base text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {activeSubmission.umpan_balik_ai}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-100">
                      <div className="text-xs font-semibold text-slate-500 mb-1">
                        Jawaban yang Dikumpulkan
                      </div>
                      <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {activeSubmission.jawaban_teks}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
