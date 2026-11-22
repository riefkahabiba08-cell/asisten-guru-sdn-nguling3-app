import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Lock, X } from 'lucide-react';

export const TEACHER_ACCESS_PASSWORD = 'Nguling67185';
export const TEACHER_AUTH_STORAGE_KEY = 'sdn_nguling3_teacher_unlocked';

interface TeacherAuthGateProps {
  isModal?: boolean;
  onUnlockSuccess: () => void;
  onCancel?: () => void;
}

export function TeacherAuthGate({
  isModal = false,
  onUnlockSuccess,
  onCancel,
}: TeacherAuthGateProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password.trim() === TEACHER_ACCESS_PASSWORD) {
      try {
        sessionStorage.setItem(TEACHER_AUTH_STORAGE_KEY, 'true');
      } catch {
        // Abaikan jika sessionStorage tidak tersedia
      }
      setError(null);
      setPassword('');
      onUnlockSuccess();
      return;
    }

    setError('Password akses guru tidak sesuai. Silakan periksa kembali.');
  };

  const cardContent = (
    <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-teal-700" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">
              SDN Nguling 3 · Akses Terbatas
            </p>
            <h2 className="text-lg font-bold text-slate-900">
              Kunci Akses Dashboard Guru
            </h2>
          </div>
        </div>
        {isModal && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Tutup jendela kunci akses guru"
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <p className="mt-4 text-sm text-slate-600 leading-relaxed">
        Masukkan password guru untuk membuka halaman Dashboard Guru, membuat
        tugas baru, melihat rekap nilai, atau mengelola data siswa.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor="teacher-access-password"
            className="block text-sm font-medium text-slate-800 mb-1.5"
          >
            Password Guru
          </label>
          <div className="relative">
            <input
              id="teacher-access-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoFocus
              placeholder="Masukkan password akses guru"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className="w-full pl-3.5 pr-11 py-2.5 text-base font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700 min-h-[44px]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? 'Sembunyikan password' : 'Tampilkan password'
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800 rounded-md"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg"
          >
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors min-h-[44px]"
            >
              Kembali ke Portal Siswa
            </button>
          )}
          <button
            type="submit"
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            Buka Akses Guru
          </button>
        </div>
      </form>
    </div>
  );

  if (isModal) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Kunci Akses Guru"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      >
        {cardContent}
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 flex items-center justify-center">
      {cardContent}
    </main>
  );
}
