import { fetchApiJson } from './api';
import { getSupabaseClient } from './supabase';
import type {
  Assignment,
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

function isMissingTableMessage(msg: string, code?: string): boolean {
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist')
  );
}

function shouldFallbackToDirectSupabase(
  errorCode: string | null,
  status: number,
): boolean {
  return (
    errorCode === 'NETWORK_ERROR' ||
    errorCode === 'NON_JSON_RESPONSE' ||
    errorCode === 'SUPABASE_NOT_CONFIGURED' ||
    status === 0 ||
    status === 502 ||
    status === 504
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

export async function fetchTeacherDashboardData(): Promise<
  DataResult<{
    assignments: Assignment[];
    submissions: SubmissionWithDetails[];
    students: Student[];
  }>
> {
  const supabase = getSupabaseClient();

  const [assignRes, subRes, studRes] = await Promise.all([
    fetchApiJson<{ assignments: Assignment[] }>(
      '/api/assignments?role=teacher',
    ),
    fetchApiJson<{ submissions: SubmissionWithDetails[] }>('/api/submissions'),
    fetchApiJson<{ students: Student[] }>('/api/students'),
  ]);

  const apiFailedForInfra =
    shouldFallbackToDirectSupabase(assignRes.errorCode, assignRes.status) ||
    shouldFallbackToDirectSupabase(subRes.errorCode, subRes.status);

  if (!apiFailedForInfra && assignRes.ok && subRes.ok) {
    return {
      ok: true,
      data: {
        assignments: assignRes.data?.assignments || [],
        submissions: subRes.data?.submissions || [],
        students: studRes.ok ? studRes.data?.students || [] : [],
      },
    };
  }

  // Fallback langsung ke Supabase jika endpoint server lokal belum siap
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

    let subDirect = await supabase
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (subDirect.error?.message?.includes('created_at')) {
      subDirect = await supabase
        .from('submissions')
        .select('*')
        .order('id', { ascending: false });
    }

    const studDirect = await supabase
      .from('students')
      .select('*')
      .order('no_absen', { ascending: true });

    const firstErr = assignError || subDirect.error || studDirect.error;
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
      (subDirect.data || []) as Record<string, unknown>[]
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

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
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

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menyimpan tugas baru.',
    code: res.errorCode,
  };
}

export async function deleteAssignmentData(
  id: string | number,
): Promise<DataResult<boolean>> {
  const res = await fetchApiJson(
    `/api/assignments/${encodeURIComponent(String(id))}`,
    { method: 'DELETE' },
  );

  if (res.ok) {
    return { ok: true, data: true };
  }

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
    const { error } = await supabase.from('assignments').delete().eq('id', id);
    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return { ok: true, data: true };
  }

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menghapus tugas.',
    code: res.errorCode,
  };
}

export async function fetchStudentsData(): Promise<DataResult<Student[]>> {
  const res = await fetchApiJson<{ students: Student[] }>('/api/students');
  if (res.ok && res.data?.students) {
    return { ok: true, data: res.data.students };
  }

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
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

  return {
    ok: false,
    error: res.errorMessage || 'Gagal memuat daftar siswa.',
    code: res.errorCode,
  };
}

export async function createStudentData(
  input: StudentInput,
): Promise<DataResult<Student>> {
  const res = await fetchApiJson<{ student: Student }>('/api/students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (res.ok && res.data?.student) {
    return { ok: true, data: res.data.student };
  }

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
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

  return {
    ok: false,
    error: res.errorMessage || 'Gagal menambahkan data siswa.',
    code: res.errorCode,
  };
}

export async function bulkImportStudentsData(
  items: StudentInput[],
): Promise<DataResult<Student[]>> {
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

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
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

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
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

  return {
    ok: false,
    error: res.errorMessage || 'Gagal memperbarui data siswa.',
    code: res.errorCode,
  };
}

export async function deleteStudentData(
  id: string | number,
): Promise<DataResult<boolean>> {
  const res = await fetchApiJson(
    `/api/students/${encodeURIComponent(String(id))}`,
    { method: 'DELETE' },
  );

  if (res.ok) {
    return { ok: true, data: true };
  }

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
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
  const res = await fetchApiJson<{ student: Student }>('/api/students/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ no_absen: noAbsen, pin }),
  });

  if (res.ok && res.data?.student) {
    return { ok: true, data: res.data.student };
  }

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(res.errorCode, res.status)
  ) {
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

  return {
    ok: false,
    error: res.errorMessage || 'Gagal masuk ke Portal Siswa.',
    code: res.errorCode,
  };
}

export async function fetchStudentWorkspaceData(
  studentId: string | number,
): Promise<DataResult<{ assignments: Assignment[]; submissions: Submission[] }>> {
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

  const supabase = getSupabaseClient();
  if (
    supabase &&
    shouldFallbackToDirectSupabase(assignRes.errorCode, assignRes.status)
  ) {
    const assignInitial = await supabase
      .from('assignments')
      .select('id, judul, instruksi_soal, created_at')
      .order('created_at', { ascending: false });

    let assignRows: unknown[] | null = assignInitial.data;
    let assignError = assignInitial.error;

    if (assignError?.message?.includes('created_at')) {
      const assignFallback = await supabase
        .from('assignments')
        .select('id, judul, instruksi_soal')
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

    const subDirect = await supabase
      .from('submissions')
      .select('*')
      .eq('student_id', studentId);

    return {
      ok: true,
      data: {
        assignments: (assignRows || []) as Assignment[],
        submissions: (subDirect.data || []) as Submission[],
      },
    };
  }

  return {
    ok: false,
    error: assignRes.errorMessage || 'Gagal memuat daftar tugas.',
    code: assignRes.errorCode,
  };
}
