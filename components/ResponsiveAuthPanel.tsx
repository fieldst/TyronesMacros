import React from 'react';
import Modal from './Modal';
/**
 * NOTE: adjust these imports if your auth helper file exports different names/paths.
 * The file assumes your auth utilities expose:
 * - getUserId(): Promise<string | null>
 * - getUserProfile(): Promise<{ email: string | null; full_name: string | null }>
 * - onAuthChange(callback: () => void): () => void   (returns unsubscribe)
 * - signInWithPassword(email, password): Promise<void>
 * - signUpWithPassword(email, password, fullName): Promise<void>
 * - updateFullName(fullName): Promise<void>
 * - signOut(): Promise<void>
 *
 * If your project uses different names, rename these imports accordingly.
 */
import {
  getUserId,
  getUserProfile,
  onAuthChange,
  signInWithPassword,
  signUpWithPassword,
  updateFullName,
  signOut,
} from '../auth';

const ResponsiveAuthPanel: React.FC = () => {
  // auth state
  const [userId, setUserId] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<{ email: string | null; full_name: string | null }>({
    email: null,
    full_name: null,
  });

  // UI state
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);

  // mobile modal
  const [openMobileAuth, setOpenMobileAuth] = React.useState(false);

  // bootstrap auth listeners
  React.useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        setUserId(await getUserId());
        setProfile(await getUserProfile());
      } catch (e) {
        // ignore bootstrap errors
      }
      // subscribe to auth changes
      unsub = onAuthChange(async () => {
        try {
          setUserId(await getUserId());
          setProfile(await getUserProfile());
        } catch (e) {}
      });
    })();
    return () => unsub();
  }, []);

  const resetInputs = () => {
    setEmail('');
    setPassword('');
    setFullName('');
  };

  const doSignIn = async () => {
    setPending(true);
    try {
      await signInWithPassword(email.trim(), password);
      resetInputs();
      setOpenMobileAuth(false);
    } catch (e: any) {
      alert(e?.message || 'Sign in failed');
    } finally {
      setPending(false);
    }
  };

  const doSignUp = async () => {
    if (!fullName.trim()) return alert('Please enter your full name.');
    if (!password) return alert('Please choose a password.');
    setPending(true);
    try {
      await signUpWithPassword(email.trim(), password, fullName.trim());
      resetInputs();
      setMode('signin');
      alert('Account created. Please sign in.');
    } catch (e: any) {
      alert(e?.message || 'Sign up failed');
    } finally {
      setPending(false);
    }
  };

  const doUpdateName = async () => {
    if (!fullName.trim()) return;
    setPending(true);
    try {
      await updateFullName(fullName.trim());
      setProfile(await getUserProfile());
      setEditingName(false);
      alert('Name updated.');
    } catch (e: any) {
      alert(e?.message || 'Update failed');
    } finally {
      setPending(false);
    }
  };

  // Signed-in UI
  if (userId) {
    return (
      <div className="min-w-0 flex items-center gap-2">
        {/* Desktop / tablet: show inline */}
        <div className="hidden sm:flex items-center gap-2 text-sm">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name"
                className="px-2 py-1 rounded text-black"
              />
              <button onClick={doUpdateName} disabled={pending} className="bg-white/20 px-2 py-1 rounded">
                Save
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setFullName(profile.full_name || '');
                }}
                className="bg-white/10 px-2 py-1 rounded"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="font-semibold truncate max-w-[9rem]">{profile.full_name || 'Unnamed User'}</div>
              <div className="text-xs opacity-90 truncate max-w-[10rem]">{profile.email}</div>
              <button
                onClick={() => {
                  setFullName(profile.full_name || '');
                  setEditingName(true);
                }}
                className="ml-1 bg-white/20 px-2 py-1 rounded"
              >
                Edit
              </button>
            </>
          )}
        </div>

        {/* Sign out (visible all sizes) */}
        <button onClick={signOut} className="bg-white/20 px-3 py-1 rounded text-sm">
          Sign out
        </button>
      </div>
    );
  }

  // Signed-out UI
  return (
    <>
      {/* Desktop / tablet inline form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mode === 'signin' ? doSignIn() : doSignUp();
        }}
        className="hidden sm:flex items-center gap-2"
      >
        {mode === 'signup' && (
          <input
            type="text"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="px-2 py-1 rounded text-black"
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-2 py-1 rounded text-black"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-1 rounded text-black"
          required
        />
        <button type="submit" disabled={pending} className="bg-white/20 px-3 py-1 rounded text-sm">
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
          className="underline text-white/90 text-sm ml-1"
        >
          {mode === 'signin' ? 'Create account' : 'I have an account'}
        </button>
      </form>

      {/* Mobile: compact button -> modal */}
      <button
        type="button"
        onClick={() => setOpenMobileAuth(true)}
        className="sm:hidden bg-white text-primary text-sm font-semibold px-3 py-1 rounded"
      >
        Account
      </button>

      <Modal isOpen={openMobileAuth} onClose={() => setOpenMobileAuth(false)} title={mode === 'signin' ? 'Sign in' : 'Sign up'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mode === 'signin' ? doSignIn() : doSignUp();
          }}
          className="space-y-3"
        >
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-medium mb-1">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full input-style"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full input-style"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full input-style"
              required
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
              className="text-sm underline"
            >
              {mode === 'signin' ? 'Create account' : 'I have an account'}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="bg-primary text-white font-semibold px-4 py-2 rounded disabled:opacity-60"
            >
              {mode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};

export default ResponsiveAuthPanel;
