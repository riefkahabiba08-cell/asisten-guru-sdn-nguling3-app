import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT =
  process.env.NODE_ENV === 'production'
    ? Number(process.env.PORT) || 3000
    : 3000;

function cleanEnvValue(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getSupabaseServerClient(): SupabaseClient | null {
  const url = cleanEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      process.env.SUPABASE_URL,
  );
  const anonKey = cleanEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY,
  );

  if (!url || !anonKey || !isValidHttpUrl(url)) {
    return null;
  }
  try {
    return createClient(url, anonKey);
  } catch {
    return null;
  }
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = cleanEnvValue(
    process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY,
  );
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
) {
  const fallbackModels = Array.from(
    new Set([
      params.model,
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]),
  );

  let lastError: unknown;
  for (const modelName of fallbackModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await ai.models.generateContent({
          ...params,
          model: modelName,
        });
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const lower = msg.toLowerCase();
        const isNotFound = msg.includes('404') || lower.includes('not_found');
        const isTransient =
          msg.includes('503') ||
          msg.includes('429') ||
          lower.includes('unavailable') ||
          lower.includes('resource_exhausted') ||
          lower.includes('high demand') ||
          lower.includes('overloaded');

        if (isNotFound) {
          break;
        }
        if (isTransient) {
          if (attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            continue;
          }
          break;
        }
        throw err;
      }
    }
  }
  throw lastError;
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

function mapSupabaseError(error: { code?: string; message?: string }) {
  const code = error.code || '';
  const msg = error.message || 'Terjadi kesalahan pada database Supabase.';
  const isMissingTable =
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist');

  return {
    status: isMissingTable ? 503 : 400,
    body: {
      error: isMissingTable
        ? 'Tabel Supabase belum dibuat atau belum ditemukan di skema public.'
        : msg,
      code: isMissingTable ? 'TABLE_MISSING' : code || 'SUPABASE_ERROR',
    },
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const supabaseReady = Boolean(getSupabaseServerClient());
    const geminiReady = Boolean(
      cleanEnvValue(
        process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY,
      ),
    );
    res.json({
      ok: true,
      supabaseConfigured: supabaseReady,
      geminiConfigured: geminiReady,
    });
  });

  app.post('/api/students/login', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error:
          'Koneksi Supabase belum dikonfigurasi (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { no_absen, pin } = req.body ?? {};
    if (
      no_absen === undefined ||
      no_absen === null ||
      String(no_absen).trim() === '' ||
      pin === undefined ||
      pin === null ||
      String(pin).trim() === ''
    ) {
      return res.status(400).json({
        error: 'Nomor absen dan PIN wajib diisi.',
      });
    }

    const { data, error } = await supabase.from('students').select('*');
    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    const targetAbsen = normalizeNoAbsen(no_absen);
    const targetPin = String(pin).trim();

    const matched = (data || []).find(
      (row: Record<string, unknown>) =>
        normalizeNoAbsen(row.no_absen as string | number) === targetAbsen &&
        String(row.pin ?? '').trim() === targetPin,
    );

    if (!matched) {
      return res.status(401).json({
        error: 'Nomor absen atau PIN siswa tidak sesuai. Silakan periksa kembali.',
      });
    }

    return res.json({
      student: {
        id: matched.id,
        no_absen: matched.no_absen,
        nama_lengkap: extractStudentName(matched),
        kelas: matched.kelas ?? null,
      },
    });
  });

  app.get('/api/students', async (_req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('no_absen', { ascending: true });

    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    const students = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      no_absen: row.no_absen,
      nama_lengkap: extractStudentName(row),
      pin: String(row.pin ?? ''),
      kelas: row.kelas ?? null,
    }));

    return res.json({ students });
  });

  app.post('/api/students', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { no_absen, nama_lengkap, nama, pin, kelas } = req.body ?? {};
    const fullName = String(nama_lengkap ?? nama ?? '').trim();
    if (!no_absen || !fullName || !pin) {
      return res.status(400).json({
        error: 'Nomor absen, nama lengkap siswa, dan PIN wajib diisi.',
      });
    }

    const basePayload: Record<string, unknown> = {
      no_absen: String(no_absen).trim(),
      nama_lengkap: fullName,
      pin: String(pin).trim(),
    };
    if (kelas && String(kelas).trim()) {
      basePayload.kelas = String(kelas).trim();
    }

    let { data, error } = await supabase
      .from('students')
      .insert([basePayload])
      .select('*')
      .single();

    if (error && basePayload.kelas && error.message?.includes('kelas')) {
      delete basePayload.kelas;
      const retry = await supabase
        .from('students')
        .insert([basePayload])
        .select('*')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.status(201).json({
      student: {
        id: data.id,
        no_absen: data.no_absen,
        nama_lengkap: extractStudentName(data),
        pin: String(data.pin ?? ''),
        kelas: data.kelas ?? null,
      },
    });
  });

  app.post('/api/students/bulk', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const rawList = Array.isArray(req.body?.students) ? req.body.students : [];
    if (rawList.length === 0) {
      return res.status(400).json({
        error: 'Daftar siswa yang akan diimpor tidak boleh kosong.',
      });
    }

    const payloads = rawList
      .map((item: Record<string, unknown>) => {
        const no_absen = String(item.no_absen ?? '').trim();
        const nama_lengkap = String(
          item.nama_lengkap ?? item.nama ?? '',
        ).trim();
        const pin = String(item.pin ?? '').trim();
        const kelas = String(item.kelas ?? '').trim();
        if (!no_absen || !nama_lengkap || !pin) return null;
        return kelas
          ? { no_absen, nama_lengkap, pin, kelas }
          : { no_absen, nama_lengkap, pin };
      })
      .filter(Boolean) as Record<string, unknown>[];

    if (payloads.length === 0) {
      return res.status(400).json({
        error:
          'Format data tidak valid. Pastikan setiap baris memiliki no_absen, nama_lengkap, dan pin.',
      });
    }

    let { data, error } = await supabase
      .from('students')
      .upsert(payloads, { onConflict: 'no_absen' })
      .select('*');

    if (error && error.message?.includes('kelas')) {
      const withoutKelas = payloads.map(({ no_absen, nama_lengkap, pin }) => ({
        no_absen,
        nama_lengkap,
        pin,
      }));
      const retry = await supabase
        .from('students')
        .upsert(withoutKelas, { onConflict: 'no_absen' })
        .select('*');
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      // Fallback ke insert biasa jika tidak ada unique constraint pada no_absen
      const fallback = await supabase
        .from('students')
        .insert(payloads)
        .select('*');
      if (fallback.error) {
        const mapped = mapSupabaseError(fallback.error);
        return res.status(mapped.status).json(mapped.body);
      }
      data = fallback.data;
    }

    const students = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      no_absen: row.no_absen,
      nama_lengkap: extractStudentName(row),
      pin: String(row.pin ?? ''),
      kelas: row.kelas ?? null,
    }));

    return res.status(201).json({ students, count: students.length });
  });

  app.patch('/api/students/:id', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { id } = req.params;
    const { no_absen, nama_lengkap, nama, pin, kelas } = req.body ?? {};
    const fullName = String(nama_lengkap ?? nama ?? '').trim();
    if (!no_absen || !fullName || !pin) {
      return res.status(400).json({
        error: 'Nomor absen, nama lengkap, dan PIN wajib diisi.',
      });
    }

    const updates: Record<string, unknown> = {
      no_absen: String(no_absen).trim(),
      nama_lengkap: fullName,
      pin: String(pin).trim(),
      kelas: kelas && String(kelas).trim() ? String(kelas).trim() : null,
    };

    let { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error && error.message?.includes('kelas')) {
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
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.json({
      student: {
        id: data.id,
        no_absen: data.no_absen,
        nama_lengkap: extractStudentName(data),
        pin: String(data.pin ?? ''),
        kelas: data.kelas ?? null,
      },
    });
  });

  app.delete('/api/students/:id', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { id } = req.params;
    const { error } = await supabase.from('students').delete().eq('id', id);

    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.json({ deleted: true });
  });

  app.post('/api/students/extract', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY belum tersedia di lingkungan server. Silakan atur di panel Secrets.',
        code: 'GEMINI_NOT_CONFIGURED',
      });
    }

    const { fileName, extractedText, inlineDataParts } = req.body ?? {};
    const hasText = typeof extractedText === 'string' && extractedText.trim().length > 0;
    const hasInline = Array.isArray(inlineDataParts) && inlineDataParts.length > 0;

    if (!hasText && !hasInline) {
      return res.status(400).json({
        error: 'Data file atau gambar tidak boleh kosong.',
      });
    }

    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (hasInline) {
      for (const p of inlineDataParts) {
        if (p?.mimeType && p?.data) {
          parts.push({
            inlineData: {
              mimeType: String(p.mimeType),
              data: String(p.data),
            },
          });
        }
      }
    }

    parts.push({
      text: [
        `Nama File: ${String(fileName || 'daftar_siswa')}`,
        hasText
          ? `Isi Data Teks/Spreadsheet:\n${String(extractedText).trim()}`
          : 'Bacalah gambar atau dokumen PDF terlampir secara menyeluruh.',
        '',
        'Instruksi Ekstraksi:',
        '1. Ekstrak seluruh siswa yang ada pada dokumen/tabel ke dalam array JSON `students`.',
        '2. Untuk setiap siswa, ambil `no_absen` (nomor urut/absen, pertahankan format seperti "01" atau "1" sesuai dokumen, atau isi nomor urut jika tidak tertulis), `nama_lengkap` (nama lengkap siswa dengan ejaan kapital yang rapi), `kelas` (nama kelas jika tercantum pada kolom atau judul dokumen, misalnya "Kelas 5A", atau string kosong "" jika tidak ada), dan `pin` (ambil jika sudah ada kolom PIN, atau string kosong "" jika belum ada kolom PIN).',
        '3. Jangan sertakan baris header judul tabel sebagai siswa.',
      ].join('\n'),
    });

    try {
      const response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction:
            'Anda adalah asisten administrasi sekolah dasar (SDN Nguling 3) yang sangat teliti mengekstrak daftar absen siswa dari dokumen, spreadsheet, PDF, maupun foto/gambar daftar hadir. Kembalikan daftar seluruh siswa dalam format JSON terstruktur sesuai skema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              students: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    no_absen: {
                      type: Type.STRING,
                      description: 'Nomor absen atau nomor urut siswa.',
                    },
                    nama_lengkap: {
                      type: Type.STRING,
                      description: 'Nama lengkap siswa.',
                    },
                    kelas: {
                      type: Type.STRING,
                      description: 'Nama kelas siswa jika ada, atau string kosong.',
                    },
                    pin: {
                      type: Type.STRING,
                      description:
                        'PIN 4 digit siswa jika ada di dokumen, atau string kosong jika belum ada.',
                    },
                  },
                  required: ['no_absen', 'nama_lengkap'],
                },
              },
            },
            required: ['students'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        return res.status(502).json({
          error: 'Gemini AI tidak mengembalikan daftar siswa dari file tersebut.',
        });
      }

      const parsed = JSON.parse(rawText) as {
        students?: Array<{
          no_absen?: string | number;
          nama_lengkap?: string;
          kelas?: string;
          pin?: string | number;
        }>;
      };

      return res.json({ students: parsed.students || [] });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengekstrak daftar siswa.';
      console.error('Gemini student extraction error:', message);
      return res.status(502).json({
        error: `Ekstraksi data siswa dengan AI gagal: ${message}`,
      });
    }
  });

  app.get('/api/assignments', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const role = req.query.role === 'teacher' ? 'teacher' : 'student';

    const initialRes =
      role === 'teacher'
        ? await supabase
            .from('assignments')
            .select('id, judul, instruksi_soal, kunci_rubrik, created_at')
            .order('created_at', { ascending: false })
        : await supabase
            .from('assignments')
            .select('id, judul, instruksi_soal, created_at')
            .order('created_at', { ascending: false });

    let data: unknown[] | null = initialRes.data;
    let error = initialRes.error;

    if (error && error.message?.includes('created_at')) {
      const retry =
        role === 'teacher'
          ? await supabase
              .from('assignments')
              .select('id, judul, instruksi_soal, kunci_rubrik')
              .order('id', { ascending: false })
          : await supabase
              .from('assignments')
              .select('id, judul, instruksi_soal')
              .order('id', { ascending: false });
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.json({ assignments: data || [] });
  });

  app.post('/api/assignments/generate', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY belum tersedia di lingkungan server. Silakan atur di panel Secrets.',
        code: 'GEMINI_NOT_CONFIGURED',
      });
    }

    const {
      mata_pelajaran,
      kelas,
      topik,
      jumlah_soal,
      jenis_soal,
      perintah,
    } = req.body ?? {};

    const cleanSubject = String(mata_pelajaran ?? '').trim();
    const cleanGrade = String(kelas ?? '').trim();
    const cleanTopic = String(topik ?? perintah ?? '').trim();
    const count = Math.max(1, Math.min(25, Number(jumlah_soal) || 5));
    const questionType = String(jenis_soal ?? 'Uraian').trim();

    if (!cleanTopic) {
      return res.status(400).json({
        error: 'Topik atau materi soal wajib diisi terlebih dahulu.',
      });
    }

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

    try {
      const response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          systemInstruction:
            'Anda adalah asisten penyusun paket soal Sekolah Dasar (SD) di SDN Nguling 3 yang menguasai Kurikulum Merdeka. Susun paket soal multi-nomor yang jelas, bebas typo, edukatif untuk siswa SD. Selalu gunakan karakter baris baru (\\n) untuk memisahkan setiap nomor soal (1., 2., 3., dst.), setiap opsi pilihan ganda (A., B., C., D.), dan setiap nomor kunci jawaban agar tampilan selalu rapi dan terstruktur.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              judul: {
                type: Type.STRING,
                description:
                  'Judul tugas yang jelas, contoh: "IPAS Kelas 5 SD - Rantai Makanan (5 Soal Pilihan Ganda)".',
              },
              instruksi_soal: {
                type: Type.STRING,
                description:
                  'Petunjuk pengerjaan singkat diikuti daftar soal bernomor 1 sampai N, dengan setiap nomor soal dipisahkan \\n\\n dan setiap opsi A., B., C., D. dipisahkan \\n.',
              },
              kunci_rubrik: {
                type: Type.STRING,
                description:
                  'Kunci jawaban lengkap bernomor 1 sampai N pada baris terpisah (\\n) beserta rubrik pembobotan nilai total 0-100.',
              },
            },
            required: ['judul', 'instruksi_soal', 'kunci_rubrik'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        return res.status(502).json({
          error: 'Gemini AI tidak mengembalikan draf soal. Silakan coba lagi.',
        });
      }

      const parsed = JSON.parse(rawText) as {
        judul?: string;
        instruksi_soal?: string;
        kunci_rubrik?: string;
      };

      const formatLines = (val: string) =>
        val
          .replace(/\r\n/g, '\n')
          .replace(/\s+(?=\b([1-9]|[12]\d)\.\s)/g, '\n\n')
          .replace(/(?<!\d\.)\s+(?=[A-D]\.\s)/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

      return res.json({
        generated: {
          judul: String(parsed.judul ?? '').trim(),
          instruksi_soal: formatLines(String(parsed.instruksi_soal ?? '')),
          kunci_rubrik: formatLines(String(parsed.kunci_rubrik ?? '')),
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Gagal menghubungi layanan Gemini AI.';
      console.error('Gemini question generation error:', message);
      return res.status(502).json({
        error: `Pembuatan soal dengan AI gagal: ${message}`,
      });
    }
  });

  app.post('/api/assignments', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { judul, instruksi_soal, kunci_rubrik } = req.body ?? {};
    if (
      !judul?.trim() ||
      !instruksi_soal?.trim() ||
      !kunci_rubrik?.trim()
    ) {
      return res.status(400).json({
        error: 'Judul tugas, instruksi soal, dan kunci rubrik wajib diisi.',
      });
    }

    const { data, error } = await supabase
      .from('assignments')
      .insert([
        {
          judul: judul.trim(),
          instruksi_soal: instruksi_soal.trim(),
          kunci_rubrik: kunci_rubrik.trim(),
        },
      ])
      .select('*')
      .single();

    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.status(201).json({ assignment: data });
  });

  app.delete('/api/assignments/:id', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const { id } = req.params;
    const { error } = await supabase.from('assignments').delete().eq('id', id);

    if (error) {
      const mapped = mapSupabaseError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.json({ deleted: true });
  });

  app.get('/api/submissions', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const studentId = req.query.student_id
      ? String(req.query.student_id)
      : null;
    const assignmentId = req.query.assignment_id
      ? String(req.query.assignment_id)
      : null;

    let query = supabase.from('submissions').select('*');
    if (studentId) {
      query = query.eq('student_id', studentId);
    }
    if (assignmentId) {
      query = query.eq('assignment_id', assignmentId);
    }

    let { data: subRows, error: subError } = await query.order('created_at', {
      ascending: false,
    });

    if (subError && subError.message?.includes('created_at')) {
      let retryQuery = supabase.from('submissions').select('*');
      if (studentId) retryQuery = retryQuery.eq('student_id', studentId);
      if (assignmentId) retryQuery = retryQuery.eq('assignment_id', assignmentId);
      const retry = await retryQuery.order('id', { ascending: false });
      subRows = retry.data;
      subError = retry.error;
    }

    if (subError) {
      const mapped = mapSupabaseError(subError);
      return res.status(mapped.status).json(mapped.body);
    }

    const [studentsResult, assignmentsResult] = await Promise.all([
      supabase.from('students').select('*'),
      supabase.from('assignments').select('id, judul'),
    ]);

    const studentMap = new Map<
      string,
      { nama: string; no_absen: string | number }
    >();
    if (!studentsResult.error && studentsResult.data) {
      for (const s of studentsResult.data as Record<string, unknown>[]) {
        studentMap.set(String(s.id), {
          nama: extractStudentName(s),
          no_absen: (s.no_absen as string | number) ?? '-',
        });
      }
    }

    const assignmentMap = new Map<string, string>();
    if (!assignmentsResult.error && assignmentsResult.data) {
      for (const a of assignmentsResult.data as Record<string, unknown>[]) {
        assignmentMap.set(String(a.id), String(a.judul ?? 'Tugas'));
      }
    }

    const enriched = (subRows || []).map((row: Record<string, unknown>) => {
      const st = studentMap.get(String(row.student_id));
      const title = assignmentMap.get(String(row.assignment_id));
      return {
        id: row.id,
        student_id: row.student_id,
        assignment_id: row.assignment_id,
        jawaban_teks: row.jawaban_teks,
        nilai: Number(row.nilai ?? 0),
        umpan_balik_ai: String(row.umpan_balik_ai ?? ''),
        created_at: row.created_at ?? null,
        student_name: st?.nama ?? `Siswa (${String(row.student_id)})`,
        student_no_absen: st?.no_absen ?? '-',
        assignment_title: title ?? `Tugas (${String(row.assignment_id)})`,
      };
    });

    return res.json({ submissions: enriched });
  });

  app.post('/api/grade-and-submit', async (req: Request, res: Response) => {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return res.status(503).json({
        error: 'Koneksi Supabase belum dikonfigurasi.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY belum tersedia di lingkungan server. Silakan atur di panel Secrets.',
        code: 'GEMINI_NOT_CONFIGURED',
      });
    }

    const { student_id, assignment_id, jawaban_teks } = req.body ?? {};
    if (!student_id || !assignment_id || !jawaban_teks?.trim()) {
      return res.status(400).json({
        error: 'ID siswa, ID tugas, dan jawaban teks wajib diisi.',
      });
    }

    const cleanAnswer = String(jawaban_teks).trim();

    const [{ data: assignment, error: assignmentErr }, { data: student }] =
      await Promise.all([
        supabase
          .from('assignments')
          .select('id, judul, instruksi_soal, kunci_rubrik')
          .eq('id', assignment_id)
          .single(),
        supabase
          .from('students')
          .select('*')
          .eq('id', student_id)
          .single(),
      ]);

    if (assignmentErr || !assignment) {
      return res.status(404).json({
        error: 'Tugas yang dipilih tidak ditemukan di database.',
      });
    }

    const studentName = student
      ? extractStudentName(student as Record<string, unknown>)
      : 'Ananda';

    try {
      const prompt = [
        `Nama Siswa: ${studentName}`,
        `Judul Tugas: ${assignment.judul}`,
        `Instruksi Soal:\n${assignment.instruksi_soal}`,
        `Kunci Jawaban & Rubrik Penilaian:\n${assignment.kunci_rubrik}`,
        `Jawaban Siswa:\n${cleanAnswer}`,
        '',
        'Berikan penilaian angka bulat 0-100 yang adil sesuai kunci rubrik untuk tingkat Sekolah Dasar (SD), serta umpan balik yang ramah, jelas, menyemangati, dan menjelaskan bagian mana yang sudah tepat serta apa yang perlu diperbaiki.',
      ].join('\n\n');

      const response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Anda adalah Asisten Guru SDN Nguling 3 yang bijaksana, ramah terhadap siswa Sekolah Dasar, dan objektif. Evaluasi jawaban teks siswa berdasarkan instruksi soal dan kunci rubrik yang diberikan guru. Kembalikan output JSON valid sesuai skema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nilai: {
                type: Type.INTEGER,
                description: 'Skor penilaian siswa dari 0 sampai 100.',
              },
              umpan_balik_ai: {
                type: Type.STRING,
                description:
                  'Umpan balik pedagogis berbahasa Indonesia yang ramah, jelas, dan memotivasi untuk siswa SD.',
              },
            },
            required: ['nilai', 'umpan_balik_ai'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        return res.status(502).json({
          error: 'Gemini AI tidak mengembalikan hasil penilaian. Silakan coba lagi.',
        });
      }

      const parsed = JSON.parse(rawText) as {
        nilai?: number;
        umpan_balik_ai?: string;
      };

      const nilaiFinal = Math.max(
        0,
        Math.min(100, Math.round(Number(parsed.nilai ?? 0))),
      );
      const umpanBalikFinal = String(
        parsed.umpan_balik_ai ||
          'Terima kasih sudah mengumpulkan jawaban. Terus semangat belajar!',
      ).trim();

      const { data: saved, error: insertErr } = await supabase
        .from('submissions')
        .insert([
          {
            student_id,
            assignment_id,
            jawaban_teks: cleanAnswer,
            nilai: nilaiFinal,
            umpan_balik_ai: umpanBalikFinal,
          },
        ])
        .select('*')
        .single();

      if (insertErr) {
        const mapped = mapSupabaseError(insertErr);
        return res.status(mapped.status).json(mapped.body);
      }

      return res.status(201).json({
        submission: {
          ...saved,
          nilai: nilaiFinal,
          umpan_balik_ai: umpanBalikFinal,
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Gagal menghubungi layanan Gemini AI.';
      console.error('Gemini grading error:', message);
      return res.status(502).json({
        error: `Proses koreksi AI gagal: ${message}`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Asisten Guru SDN Nguling 3 server listening on port ${PORT}`);
  });
}

startServer();
