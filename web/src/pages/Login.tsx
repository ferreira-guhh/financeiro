import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between border-r border-rule p-12 lg:flex">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M8 22h16M8 16h11M8 10h16" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          <span className="text-lg font-semibold">Financeiro</span>
        </div>
        <div className="max-w-md">
          <p className="text-[40px] font-semibold leading-[1.1] tracking-[-0.02em]">Cada centavo no lugar certo, antes de qualquer previsão.</p>
          <p className="mt-4 text-ink-2">Contas, cartões, parcelas e contas fixas num livro-caixa só. O painel mostra quanto você pode gastar hoje sem atrapalhar o resto do mês.</p>
        </div>
        <p className="text-[13px] text-ink-3">Seus dados ficam no seu banco de dados. Nenhuma senha bancária é pedida ou guardada.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h1 className="text-[26px] font-semibold">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
          {mode === 'register' && (
            <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />}</Field>
          )}
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />}</Field>
          <Field label="Senha" hint={mode === 'register' ? 'Pelo menos 8 caracteres.' : undefined}>
            {(id) => (
              <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            )}
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </Button>
          <p className="text-center text-sm text-ink-2">
            {mode === 'login' ? 'Primeira vez aqui? ' : 'Já tem conta? '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Criar conta' : 'Entrar'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
