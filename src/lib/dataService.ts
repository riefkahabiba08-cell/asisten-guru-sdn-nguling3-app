import * as XLSX from 'xlsx';
import { fetchApiJson } from './api';
import { getSupabaseClient } from './supabase';
import type {
  Assignment,
  GenerateAssignmentParams,
  Student,
  StudentInput,
  Submission,
  SubmissionWithDetails,
} from '../types';

export interface DataResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string | null;
}

function cleanEnvValue(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

function getClientGeminiApiKey(): string {
  return cleanEnvValue(
    process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY,
  );
}

function isMissingTableMessage(msg: string, code?: string): boolean {
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist')
  );
}

function normalizeNoAbsen(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }
  return raw.toLowerCase();
}

function extractStudentName(row: Record<string, unknown>): string {
  const candidate =
    row.nama_lengkap ?? row.nama ?? row.nama_siswa ?? row.name ?? row.full_name;
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  return `Siswa #${String(row.no_absen ?? row.id ?? '')}`;
}

function mapStudentRow(row: Record<string, unknown>): Student {
  return {
    id: row.id as string | number,
    no_absen: row.no_absen as string | number,
    nama_lengkap: extractStudentName(row),
    pin: row.pin !== undefined ? String(row.pin ?? '') : undefined,
    kelas: (row.kelas as string | null | undefined) ?? null,
  };
}

function parseJsonSafely<T>(rawText: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

async function callGeminiRestClient<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  inlineDataParts?: Array<{ mimeType: string; data: string }>;
}): Promise<DataResult<T>> {
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'GEMINI_API_KEY belum tersedia di lingkungan klien.',
      code: 'GEMINI_NOT_CONFIGURED',
    };
  }

  const candidateModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ];
  let lastErrorMessage = 'Gagal menghubungi Gemini API.';

  const userParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [{ text: params.userPrompt }];

  if (params.inlineDataParts && params.inlineDataParts.length > 0) {
    for (const part of params.inlineDataParts) {
      userParts.push({
        inlineData: {
          mimeType: part.mimeType,
          data: part.data,
        },
      });
    }
  }

  for (const modelName of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: params.systemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: userParts,
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: params.responseSchema,
            },
          }),
        });

        const payload = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
          error?: { code?: number; message?: string; status?: string };
        };

        if (!res.ok) {
          const errMsg =
            payload.error?.message || `Gemini API error (${res.status})`;
          const lowerMsg = errMsg.toLowerCase();
          lastErrorMessage = `${modelName}: ${errMsg}`;

          if (res.status === 404) {
            // Model tidak tersedia untuk kunci API ini, langsung pindah ke model berikutnya
            break;
          }

          const isTransientOrDemand =
            res.status === 429 ||
            res.status === 503 ||
            lowerMsg.includes('high demand') ||
            lowerMsg.includes('unavailable') ||
            lowerMsg.includes('resource_exhausted') ||
            lowerMsg.includes('overloaded');

          if (isTransientOrDemand) {
            if (attempt === 1) {
              await new Promise((resolve) => setTimeout(resolve, 600));
              continue;
            }
            // Masih 503/429/high demand, otomatis pindah mencoba model fallback berikutnya
            break;
          }

          return {
            ok: false,
            error: `Layanan AI gagal merespons: ${errMsg}`,
            code: payload.error?.status || 'GEMINI_ERROR',
          };
        }

        const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (!rawText.trim()) {
          lastErrorMessage = `${modelName}: respons AI kosong.`;
          break;
        }

        const parsed = parseJsonSafely<T>(rawText);
        return { ok: true, data: parsed };
      } catch (err: unknown) {
        lastErrorMessage =
          err instanceof Error ? err.message : 'Gangguan jaringan ke Gemini API.';
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          continue;
        }
        break;
      }
    }
  }

  return {
    ok: false,
    error: `Pemanggilan Gemini API gagal: ${lastErrorMessage}`,
    code: 'GEMINI_ERROR',
  };
}

function formatMultilineQuestionText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\s+(?=\b([1-9]|[12]\d)\.\s)/g, '\n\n')
    .replace(/(?<!\d\.)\s+(?=[A-D]\.\s)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function generateAssignmentPackageData(
  params: GenerateAssignmentParams,
): Promise<
  DataResult<{
    judul: string;
    instruksi_soal: string;
    kunci_rubrik: string;
  }>
> {
  const cleanSubject = params.mata_pelajaran.trim();
  const cleanGrade = params.kelas.trim();
  const cleanTopic = params.topik.trim();
  const count = Math.max(1, Math.min(25, Number(params.jumlah_soal) || 5));
  const questionType = params.jenis_soal;

  if (!cleanTopic) {
    return {
      ok: false,
      error: 'Topik / Materi wajib diisi terlebih dahulu.',
    };
  }

  const clientKey = getClientGeminiApiKey();
  if (clientKey) {
    const userPrompt = [
      `Mata Pelajaran: ${cleanSubject || 'Tematik SD'}`,
      `Tingkat Kelas: ${cleanGrade || 'Sekolah Dasar (SD)'}`,
      `Topik / Materi: ${cleanTopic}`,
      `Jumlah Soal: ${count} butir soal`,
      `Jenis Soal: ${questionType}`,
      '',
      'Tugas Anda:',
      `1. Buatlah tepat ${count} butir soal bertipe "${questionType}" yang sesuai dengan tingkat pemahaman siswa ${cleanGrade || 'SD'} tentang topik "${cleanTopic}".`,
      '2. ATURAN FORMAT WAJIB (Baris Baru): Pada field instruksi_soal, setiap nomor soal (1., 2., 3., dst.) WAJIB dipisahkan dengan baris baru (\\n\\n) agar tidak menyatu dalam satu paragraf.',
      questionType === 'Pilihan Ganda'
        ? '3. Untuk setiap soal Pilihan Ganda, tuliskan 4 opsi jawaban (A., B., C., D.) dan WAJIB letakkan setiap opsi pada baris baru terpisah (\\nA. ...\\nB. ...\\nC. ...\\nD. ...).'
        : questionType === 'Campuran'
          ? '3. Kombinasikan soal Pilihan Ganda (dengan masing-masing opsi A., B., C., D. pada baris baru terpisah) dan soal Isian Singkat / Uraian secara proporsional hingga genap berjumlah sesuai jumlah soal.'
          : '3. Tuliskan petunjuk pengerjaan di baris paling atas, lalu pisahkan setiap nomor soal (1., 2., 3., dst.) pada baris baru yang rapi.',
      `4. Pada bagian kunci_rubrik, tuliskan kunci jawaban bernomor 1 sampai ${count} dengan setiap nomor berada pada baris baru (\\n), diikuti bagian Rubrik Penilaian (skala 0-100) pada paragraf baru yang rapi.`,
    ].join('\n');

    const aiRes = await callGeminiRestClient<{
      judul?: string;
      instruksi_soal?: string;
      kunci_rubrik?: string;
    }>({
      systemInstruction:
        'Anda adalah asisten penyusun paket soal Sekolah Dasar (SD) di SDN Nguling 3 yang menguasai Kurikulum Merdeka. Susun paket soal multi-nomor yang jelas, bebas typo, edukatif untuk siswa SD. Selalu gunakan karakter baris baru (\\n) untuk memisahkan setiap nomor soal (1., 2., 3., dst.), setiap opsi pilihan ganda (A., B., C., D.), dan setiap nomor kunci jawaban agar tampilan selalu rapi dan terstruktur.',
      userPrompt,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          judul: {
            type: 'STRING',
            description:
              'Judul tugas yang jelas, contoh: "IPAS Kelas 5 SD - Rantai Makanan (5 Soal Pilihan Ganda)".',
          },
          instruksi_soal: {
            type: 'STRING',
            description:
              'Petunjuk pengerjaan singkat diikuti daftar soal bernomor 1 sampai N, dengan setiap nomor soal dipisahkan \\n\\n dan setiap opsi A., B., C., D. dipisahkan \\n.',
          },
          kunci_rubrik: {
            type: 'STRING',
            description:
              'Kunci jawaban lengkap bernomor 1 sampai N pada baris terpisah (\\n) beserta rubrik pembobotan nilai total 0-100.',
          },
        },
        required: ['judul', 'instruksi_soal', 'kunci_rubrik'],
      },
    });

    if (aiRes.ok && aiRes.data) {
      return {
        ok: true,
        data: {
          judul: String(aiRes.data.judul ?? '').trim(),
          instruksi_soal: formatMultilineQuestionText(
            String(aiRes.data.instruksi_soal ?? ''),
          ),
          kunci_rubrik: formatMultilineQuestionText(
            String(aiRes.data.kunci_rubrik ?? ''),
          ),
        },
      };
    }

    return {
      ok: false,
      error: aiRes.error || 'Gagal menyusun paket soal dengan Gemini AI.',
      code: aiRes.code,
    };
  }

  // Fallback jika GEMINI_API_KEY hanya tersedia di runtime server lokal
  const apiRes = await fetchApiJson<{
    generated: {
      judul: string;
      instruksi_soal: string;
      kunci_rubrik: string;
    };
  }>('/api/assignments/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mata_pelajaran: cleanSubject || 'Tematik SD',
      kelas: cleanGrade,
      topik: cleanTopic,
      jumlah_soal: count,
      jenis_soal: questionType,
    }),
  });

  if (apiRes.ok && apiRes.data?.generated) {
    return { ok: true, data: apiRes.data.generated };
  }

  return {
    ok: false,
    error:
      apiRes.errorMessage ||
      'GEMINI_API_KEY belum dikonfigurasi. Tambahkan GEMINI_API_KEY di environment variables.',
    code: apiRes.errorCode,
  };
}

export async function gradeAndSubmitAnswerData(params: {
  student: Student;
  assignment: Assignment;
  jawaban_teks: string;
}): Promise<DataResult<Submission>> {
  const cleanAnswer = params.jawaban_teks.trim();
  if (!cleanAnswer) {
    return {
      ok: false,
      error: 'Silakan tulis jawaban Anda terlebih dahulu sebelum mengirim.',
    };
  }

  const supabase = getSupabaseClient();
  const clientKey = getClientGeminiApiKey();

  // Jalankan langsung dari klien (Supabase + Gemini REST API) agar tidak bergantung pada /api/* di Vercel
  if (supabase && clientKey) {
    let rubric = params.assignment.kunci_rubrik || '';
    let judul = params.assignment.judul;
    let instruksi = params.assignment.instruksi_soal;

    if (!rubric) {
      const { data: assignRow, error: assignErr } = await supabase
        .from('assignments')
        .select('id, judul, instruksi_soal, kunci_rubrik')
        .eq('id', params.assignment.id)
        .single();

      if (assignErr || !assignRow) {
        return {
          ok: false,
          error:
            assignErr?.message || 'Tugas tidak ditemukan di database Supabase.',
        };
      }
      rubric = String(assignRow.kunci_rubrik ?? '');
      judul = String(assignRow.judul ?? judul);
      instruksi = String(assignRow.instruksi_soal ?? instruksi);
    }

    const prompt = [
      `Nama Siswa: ${params.student.nama_lengkap}`,
      `Judul Tugas: ${judul}`,
      `Instruksi Soal:\n${instruksi}`,
      `Kunci Jawaban & Rubrik Penilaian:\n${rubric}`,
      `Jawaban Siswa:\n${cleanAnswer}`,
      '',
      'Berikan penilaian angka bulat 0-100 yang adil sesuai kunci rubrik untuk tingkat Sekolah Dasar (SD), serta umpan balik yang ramah, jelas, menyemangati, dan menjelaskan bagian mana yang sudah tepat serta apa yang perlu diperbaiki.',
    ].join('\n\n');

    const aiRes = await callGeminiRestClient<{
      nilai?: number;
      umpan_balik_ai?: string;
    }>({
      systemInstruction:
        'Anda adalah Asisten Guru SDN Nguling 3 yang bijaksana, ramah terhadap siswa Sekolah Dasar, dan objektif. Evaluasi jawaban teks siswa berdasarkan instruksi soal dan kunci rubrik yang diberikan guru. Kembalikan output JSON valid sesuai skema.',
      userPrompt: prompt,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          nilai: {
            type: 'INTEGER',
            description: 'Skor penilaian siswa dari 0 sampai 100.',
          },
          umpan_balik_ai: {
            type: 'STRING',
            description:
              'Umpan balik pedagogis berbahasa Indonesia yang ramah, jelas, dan memotivasi untuk siswa SD.',
          },
        },
        required: ['nilai', 'umpan_balik_ai'],
      },
    });

    if (!aiRes.ok || !aiRes.data) {
      return {
        ok: false,
        error: aiRes.error || 'Proses koreksi AI gagal.',
        code: aiRes.code,
      };
    }

    const nilaiFinal = Math.max(
      0,
      Math.min(100, Math.round(Number(aiRes.data.nilai ?? 0))),
    );
    const umpanBalikFinal = String(
      aiRes.data.umpan_balik_ai ||
        'Terima kasih sudah mengumpulkan jawaban. Terus semangat belajar!',
    ).trim();

    const { data: saved, error: insertErr } = await supabase
      .from('submissions')
      .insert([
        {
          student_id: params.student.id,
          assignment_id: params.assignment.id,
          jawaban_teks: cleanAnswer,
          nilai: nilaiFinal,
          umpan_balik_ai: umpanBalikFinal,
        },
      ])
      .select('*')
      .single();

    if (insertErr) {
      const missing = isMissingTableMessage(insertErr.message, insertErr.code);
      return {
        ok: false,
        error: insertErr.message,
        code: missing ? 'TABLE_MISSING' : insertErr.code,
      };
    }

    return {
      ok: true,
      data: {
        ...(saved as Submission),
        nilai: nilaiFinal,
        umpan_balik_ai: umpanBalikFinal,
      },
    };
  }

  // Fallback ke server lokal jika key/env hanya tersedia di runtime server
  const res = await fetchApiJson<{ submission: Submission }>(
    '/api/grade-and-submit',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: params.student.id,
        assignment_id: params.assignment.id,
        jawaban_teks: cleanAnswer,
      }),
    },
  );

  if (res.ok && res.data?.submission) {
    return { ok: true, data: res.data.submission };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal mengoreksi dan menyimpan jawaban.',
    code: res.errorCode,
  };
}

export async function fetchTeacherDashboardData(): Promise<
  DataResult<{
    assignments: Assignment[];
    submissions: SubmissionWithDetails[];
    students: Student[];
  }>
> {
  const supabase = getSupabaseClient();

  if (supabase) {
    const assignInitial = await supabase
      .from('assignments')
      .select('id, judul, instruksi_soal, kunci_rubrik, created_at')
      .order('created_at', { ascending: false });

    let assignRows: unknown[] | null = assignInitial.data;
    let assignError = assignInitial.error;

    if (assignError?.message?.includes('created_at')) {
      const assignFallback = await supabase
        .from('assignments')
        .select('id, judul, instruksi_soal, kunci_rubrik')
        .order('id', { ascending: false });
      assignRows = assignFallback.data;
      assignError = assignFallback.error;
    }

    const subInitial = await supabase
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false });

    let subRows: unknown[] | null = subInitial.data;
    let subError = subInitial.error;

    if (subError?.message?.includes('created_at')) {
      const subFallback = await supabase
        .from('submissions')
        .select('*')
        .order('id', { ascending: false });
      subRows = subFallback.data;
      subError = subFallback.error;
    }

    const studDirect = await supabase
      .from('students')
      .select('*')
      .order('no_absen', { ascending: true });

    const firstErr = assignError || subError || studDirect.error;
    if (firstErr) {
      const missing = isMissingTableMessage(firstErr.message, firstErr.code);
      return {
        ok: false,
        error: missing
          ? 'Tabel Supabase belum dibuat atau belum ditemukan di skema public.'
          : firstErr.message,
        code: missing ? 'TABLE_MISSING' : firstErr.code || 'SUPABASE_ERROR',
      };
    }

    const assignments = (assignRows || []) as Assignment[];
    const students = ((studDirect.data || []) as Record<string, unknown>[]).map(
      mapStudentRow,
    );

    const studentMap = new Map<string, Student>();
    for (const s of students) {
      studentMap.set(String(s.id), s);
    }

    const assignmentMap = new Map<string, string>();
    for (const a of assignments) {
      assignmentMap.set(String(a.id), a.judul);
    }

    const submissions: SubmissionWithDetails[] = (
      (subRows || []) as Record<string, unknown>[]
    ).map((row) => {
      const st = studentMap.get(String(row.student_id));
      return {
        id: row.id as string | number,
        student_id: row.student_id as string | number,
        assignment_id: row.assignment_id as string | number,
        jawaban_teks: String(row.jawaban_teks ?? ''),
        nilai: Number(row.nilai ?? 0),
        umpan_balik_ai: String(row.umpan_balik_ai ?? ''),
        created_at: (row.created_at as string | undefined) ?? undefined,
        student_name: st?.nama_lengkap ?? `Siswa (${String(row.student_id)})`,
        student_no_absen: st?.no_absen ?? '-',
        assignment_title:
          assignmentMap.get(String(row.assignment_id)) ??
          `Tugas (${String(row.assignment_id)})`,
      };
    });

    return {
      ok: true,
      data: { assignments, submissions, students },
    };
  }

  const [assignRes, subRes, studRes] = await Promise.all([
    fetchApiJson<{ assignments: Assignment[] }>(
      '/api/assignments?role=teacher',
    ),
    fetchApiJson<{ submissions: SubmissionWithDetails[] }>('/api/submissions'),
    fetchApiJson<{ students: Student[] }>('/api/students'),
  ]);

  if (assignRes.ok && subRes.ok) {
    return {
      ok: true,
      data: {
        assignments: assignRes.data?.assignments || [],
        submissions: subRes.data?.submissions || [],
        students: studRes.ok ? studRes.data?.students || [] : [],
      },
    };
  }

  return {
    ok: false,
    error:
      assignRes.errorMessage ||
      subRes.errorMessage ||
      'Koneksi Supabase belum dikonfigurasi.',
    code: assignRes.errorCode || subRes.errorCode,
  };
}

export async function createAssignmentData(payload: {
  judul: string;
  instruksi_soal: string;
  kunci_rubrik: string;
}): Promise<DataResult<Assignment>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('assignments')
      .insert([payload])
      .select('*')
      .single();

    if (error) {
      const missing = isMissingTableMessage(error.message, error.code);
      return {
        ok: false,
        error: error.message,
        code: missing ? 'TABLE_MISSING' : error.code,
      };
    }
    return { ok: true, data: data as Assignment };
  }

  const res = await fetchApiJson<{ assignment: Assignment }>(
    '/api/assignments',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  if (res.ok && res.data?.assignment) {
    return { ok: true, data: res.data.assignment };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menyimpan tugas baru.',
    code: res.errorCode,
  };
}

export async function deleteAssignmentData(
  id: string | number,
): Promise<DataResult<boolean>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { error } = await supabase.from('assignments').delete().eq('id', id);
    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return { ok: true, data: true };
  }

  const res = await fetchApiJson(
    `/api/assignments/${encodeURIComponent(String(id))}`,
    { method: 'DELETE' },
  );

  if (res.ok) {
    return { ok: true, data: true };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menghapus tugas.',
    code: res.errorCode,
  };
}

export async function fetchStudentsData(): Promise<DataResult<Student[]>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('no_absen', { ascending: true });
    if (error) {
      const missing = isMissingTableMessage(error.message, error.code);
      return {
        ok: false,
        error: error.message,
        code: missing ? 'TABLE_MISSING' : error.code,
      };
    }
    return {
      ok: true,
      data: ((data || []) as Record<string, unknown>[]).map(mapStudentRow),
    };
  }

  const res = await fetchApiJson<{ students: Student[] }>('/api/students');
  if (res.ok && res.data?.students) {
    return { ok: true, data: res.data.students };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal memuat daftar siswa.',
    code: res.errorCode,
  };
}

export async function createStudentData(
  input: StudentInput,
): Promise<DataResult<Student>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const payload: Record<string, unknown> = {
      no_absen: input.no_absen.trim(),
      nama_lengkap: input.nama_lengkap.trim(),
      pin: input.pin.trim(),
    };
    if (input.kelas?.trim()) {
      payload.kelas = input.kelas.trim();
    }

    let { data, error } = await supabase
      .from('students')
      .insert([payload])
      .select('*')
      .single();

    if (error && payload.kelas && error.message.includes('kelas')) {
      delete payload.kelas;
      const retry = await supabase
        .from('students')
        .insert([payload])
        .select('*')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return { ok: true, data: mapStudentRow(data as Record<string, unknown>) };
  }

  const res = await fetchApiJson<{ student: Student }>('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (res.ok && res.data?.student) {
    return { ok: true, data: res.data.student };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menambahkan data siswa.',
    code: res.errorCode,
  };
}

export async function bulkImportStudentsData(
  items: StudentInput[],
): Promise<DataResult<Student[]>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const payloads = items.map((item) =>
      item.kelas?.trim()
        ? {
            no_absen: item.no_absen.trim(),
            nama_lengkap: item.nama_lengkap.trim(),
            pin: item.pin.trim(),
            kelas: item.kelas.trim(),
          }
        : {
            no_absen: item.no_absen.trim(),
            nama_lengkap: item.nama_lengkap.trim(),
            pin: item.pin.trim(),
          },
    );

    let { data, error } = await supabase
      .from('students')
      .upsert(payloads, { onConflict: 'no_absen' })
      .select('*');

    if (error) {
      const retry = await supabase.from('students').insert(payloads).select('*');
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return {
      ok: true,
      data: ((data || []) as Record<string, unknown>[]).map(mapStudentRow),
    };
  }

  const res = await fetchApiJson<{ students: Student[] }>(
    '/api/students/bulk',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: items }),
    },
  );

  if (res.ok && res.data?.students) {
    return { ok: true, data: res.data.students };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal mengimpor daftar siswa.',
    code: res.errorCode,
  };
}

export async function updateStudentData(
  id: string | number,
  input: StudentInput,
): Promise<DataResult<Student>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const updates: Record<string, unknown> = {
      no_absen: input.no_absen.trim(),
      nama_lengkap: input.nama_lengkap.trim(),
      pin: input.pin.trim(),
      kelas: input.kelas?.trim() ? input.kelas.trim() : null,
    };

    let { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error && error.message.includes('kelas')) {
      delete updates.kelas;
      const retry = await supabase
        .from('students')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return { ok: true, data: mapStudentRow(data as Record<string, unknown>) };
  }

  const res = await fetchApiJson<{ student: Student }>(
    `/api/students/${encodeURIComponent(String(id))}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );

  if (res.ok && res.data?.student) {
    return { ok: true, data: res.data.student };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal memperbarui data siswa.',
    code: res.errorCode,
  };
}

export async function deleteStudentData(
  id: string | number,
): Promise<DataResult<boolean>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return { ok: true, data: true };
  }

  const res = await fetchApiJson(
    `/api/students/${encodeURIComponent(String(id))}`,
    { method: 'DELETE' },
  );

  if (res.ok) {
    return { ok: true, data: true };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menghapus data siswa.',
    code: res.errorCode,
  };
}

export async function loginStudentData(
  noAbsen: string,
  pin: string,
): Promise<DataResult<Student>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.from('students').select('*');
    if (error) {
      const missing = isMissingTableMessage(error.message, error.code);
      return {
        ok: false,
        error: error.message,
        code: missing ? 'TABLE_MISSING' : error.code,
      };
    }

    const targetAbsen = normalizeNoAbsen(noAbsen);
    const targetPin = pin.trim();
    const matched = ((data || []) as Record<string, unknown>[]).find(
      (row) =>
        normalizeNoAbsen(row.no_absen as string | number) === targetAbsen &&
        String(row.pin ?? '').trim() === targetPin,
    );

    if (!matched) {
      return {
        ok: false,
        error: 'Nomor absen atau PIN siswa tidak sesuai. Silakan periksa kembali.',
      };
    }
    return { ok: true, data: mapStudentRow(matched) };
  }

  const res = await fetchApiJson<{ student: Student }>('/api/students/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ no_absen: noAbsen, pin }),
  });

  if (res.ok && res.data?.student) {
    return { ok: true, data: res.data.student };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal masuk ke Portal Siswa.',
    code: res.errorCode,
  };
}

export async function fetchStudentWorkspaceData(
  studentId: string | number,
): Promise<DataResult<{ assignments: Assignment[]; submissions: Submission[] }>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const assignInitial = await supabase
      .from('assignments')
      .select('id, judul, instruksi_soal, kunci_rubrik, created_at')
      .order('created_at', { ascending: false });

    let assignRows: unknown[] | null = assignInitial.data;
    let assignError = assignInitial.error;

    if (assignError?.message?.includes('created_at')) {
      const assignFallback = await supabase
        .from('assignments')
        .select('id, judul, instruksi_soal, kunci_rubrik')
        .order('id', { ascending: false });
      assignRows = assignFallback.data;
      assignError = assignFallback.error;
    }

    if (assignError) {
      const missing = isMissingTableMessage(
        assignError.message,
        assignError.code,
      );
      return {
        ok: false,
        error: assignError.message,
        code: missing ? 'TABLE_MISSING' : assignError.code,
      };
    }

    const subInitial = await supabase
      .from('submissions')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    let subRows = subInitial.data;
    if (subInitial.error?.message?.includes('created_at')) {
      const subFallback = await supabase
        .from('submissions')
        .select('*')
        .eq('student_id', studentId)
        .order('id', { ascending: false });
      subRows = subFallback.data;
    }

    return {
      ok: true,
      data: {
        assignments: (assignRows || []) as Assignment[],
        submissions: (subRows || []) as Submission[],
      },
    };
  }

  const [assignRes, subRes] = await Promise.all([
    fetchApiJson<{ assignments: Assignment[] }>(
      '/api/assignments?role=student',
    ),
    fetchApiJson<{ submissions: Submission[] }>(
      `/api/submissions?student_id=${encodeURIComponent(String(studentId))}`,
    ),
  ]);

  if (assignRes.ok) {
    return {
      ok: true,
      data: {
        assignments: assignRes.data?.assignments || [],
        submissions: subRes.ok ? subRes.data?.submissions || [] : [],
      },
    };
  }

  return {
    ok: false,
    error: assignRes.errorMessage || 'Gagal memuat daftar tugas.',
    code: assignRes.errorCode,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function generateUniqueFourDigitPin(usedPins: Set<string>): string {
  for (let i = 0; i < 500; i++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedPins.has(candidate)) {
      usedPins.add(candidate);
      return candidate;
    }
  }
  // Fallback deterministik jika hampir penuh
  for (let n = 1000; n <= 9999; n++) {
    const candidate = String(n);
    if (!usedPins.has(candidate)) {
      usedPins.add(candidate);
      return candidate;
    }
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function normalizeExtractedStudents(
  rawList: Array<{
    no_absen?: string | number;
    nama_lengkap?: string;
    kelas?: string;
    pin?: string | number;
  }>,
  existingPins: Set<string> = new Set(),
): StudentInput[] {
  const usedPins = new Set<string>(existingPins);
  const preliminary = rawList
    .map((item, idx) => {
      const noAbsen = String(item.no_absen ?? idx + 1).trim();
      const nama = String(item.nama_lengkap ?? '').trim();
      const kelas = String(item.kelas ?? '').trim();
      const rawPin = String(item.pin ?? '').trim();
      if (!nama) return null;
      if (rawPin && /^\d{4,8}$/.test(rawPin)) {
        usedPins.add(rawPin);
      }
      return {
        no_absen: noAbsen || String(idx + 1).padStart(2, '0'),
        nama_lengkap: nama,
        kelas,
        rawPin: rawPin && /^\d{4,8}$/.test(rawPin) ? rawPin : '',
      };
    })
    .filter(Boolean) as Array<{
    no_absen: string;
    nama_lengkap: string;
    kelas: string;
    rawPin: string;
  }>;

  return preliminary.map((item) => ({
    no_absen: item.no_absen,
    nama_lengkap: item.nama_lengkap,
    kelas: item.kelas || undefined,
    pin: item.rawPin || generateUniqueFourDigitPin(usedPins),
  }));
}

export async function extractStudentsFromFileData(
  file: File,
  existingPins: Set<string> = new Set(),
): Promise<DataResult<StudentInput[]>> {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type || '';

  const isExcel =
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.xls') ||
    mimeType.includes('spreadsheetml') ||
    mimeType.includes('ms-excel');
  const isCsvOrText =
    fileName.endsWith('.csv') ||
    fileName.endsWith('.txt') ||
    mimeType === 'text/csv' ||
    mimeType === 'text/plain';
  const isPdf = fileName.endsWith('.pdf') || mimeType === 'application/pdf';
  const isImage =
    mimeType.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(fileName);

  if (!isExcel && !isCsvOrText && !isPdf && !isImage) {
    return {
      ok: false,
      error:
        'Format file belum didukung. Gunakan file CSV, Excel (.xlsx/.xls), PDF, atau gambar/foto (.jpg/.png).',
    };
  }

  let extractedText = '';
  let inlineDataParts: Array<{ mimeType: string; data: string }> | undefined;

  try {
    if (isExcel) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetTexts = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `--- Sheet: ${name} ---\n${csv}`;
      });
      extractedText = sheetTexts.join('\n\n').trim();
      if (!extractedText) {
        return {
          ok: false,
          error: 'File Excel tampak kosong atau tidak memiliki data tabel.',
        };
      }
    } else if (isCsvOrText) {
      extractedText = (await file.text()).trim();
      if (!extractedText) {
        return {
          ok: false,
          error: 'File CSV/teks tampak kosong.',
        };
      }
    } else {
      const buffer = await file.arrayBuffer();
      const base64Data = arrayBufferToBase64(buffer);
      const resolvedMime = isPdf
        ? 'application/pdf'
        : mimeType || (fileName.endsWith('.png') ? 'image/png' : 'image/jpeg');
      inlineDataParts = [{ mimeType: resolvedMime, data: base64Data }];
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal membaca isi file.';
    return {
      ok: false,
      error: `Gagal memproses file "${file.name}": ${msg}`,
    };
  }

  const systemInstruction =
    'Anda adalah asisten administrasi sekolah dasar (SDN Nguling 3) yang sangat teliti mengekstrak daftar absen siswa dari dokumen, spreadsheet, PDF, maupun foto/gambar daftar hadir. Kembalikan daftar seluruh siswa dalam format JSON terstruktur sesuai skema.';

  const userPrompt = [
    `Nama File: ${file.name}`,
    extractedText
      ? `Isi Data Teks/Spreadsheet:\n${extractedText}`
      : 'Bacalah gambar atau dokumen PDF terlampir secara menyeluruh.',
    '',
    'Instruksi Ekstraksi:',
    '1. Ekstrak seluruh siswa yang ada pada dokumen/tabel ke dalam array JSON `students`.',
    '2. Untuk setiap siswa, ambil `no_absen` (nomor urut/absen, pertahankan format seperti "01" atau "1" sesuai dokumen, atau isi nomor urut jika tidak tertulis), `nama_lengkap` (nama lengkap siswa dengan ejaan kapital yang rapi), `kelas` (nama kelas jika tercantum pada kolom atau judul dokumen, misalnya "Kelas 5A", atau string kosong "" jika tidak ada), dan `pin` (ambil jika sudah ada kolom PIN, atau string kosong "" jika belum ada kolom PIN).',
    '3. Jangan sertakan baris header judul tabel sebagai siswa.',
  ].join('\n');

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      students: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            no_absen: {
              type: 'STRING',
              description: 'Nomor absen atau nomor urut siswa.',
            },
            nama_lengkap: {
              type: 'STRING',
              description: 'Nama lengkap siswa.',
            },
            kelas: {
              type: 'STRING',
              description: 'Nama kelas siswa jika ada, atau string kosong.',
            },
            pin: {
              type: 'STRING',
              description:
                'PIN 4 digit siswa jika ada di dokumen, atau string kosong jika belum ada.',
            },
          },
          required: ['no_absen', 'nama_lengkap'],
        },
      },
    },
    required: ['students'],
  };

  const clientKey = getClientGeminiApiKey();
  if (clientKey) {
    const aiRes = await callGeminiRestClient<{
      students?: Array<{
        no_absen?: string | number;
        nama_lengkap?: string;
        kelas?: string;
        pin?: string | number;
      }>;
    }>({
      systemInstruction,
      userPrompt,
      responseSchema,
      inlineDataParts,
    });

    if (!aiRes.ok || !aiRes.data) {
      return {
        ok: false,
        error: aiRes.error || 'Gagal mengekstrak data siswa dengan AI.',
        code: aiRes.code,
      };
    }

    const normalized = normalizeExtractedStudents(
      aiRes.data.students || [],
      existingPins,
    );
    if (normalized.length === 0) {
      return {
        ok: false,
        error:
          'AI tidak menemukan baris nama siswa pada file tersebut. Pastikan isi file terbaca jelas.',
      };
    }

    return { ok: true, data: normalized };
  }

  // Fallback ke server lokal jika GEMINI_API_KEY hanya tersedia di runtime server
  const apiRes = await fetchApiJson<{
    students: Array<{
      no_absen?: string | number;
      nama_lengkap?: string;
      kelas?: string;
      pin?: string | number;
    }>;
  }>('/api/students/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      extractedText,
      inlineDataParts,
    }),
  });

  if (apiRes.ok && apiRes.data?.students) {
    const normalized = normalizeExtractedStudents(
      apiRes.data.students,
      existingPins,
    );
    if (normalized.length === 0) {
      return {
        ok: false,
        error: 'AI tidak menemukan data siswa pada file tersebut.',
      };
    }
    return { ok: true, data: normalized };
  }

  return {
    ok: false,
    error:
      apiRes.errorMessage ||
      'GEMINI_API_KEY belum tersedia untuk memproses file dengan AI.',
    code: apiRes.errorCode,
  };
}

