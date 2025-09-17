// components/ResponsiveAuthPanel.tsx
import React, { useState, useEffect } from 'react';
import {
  getCurrentUser,
  getUserProfile,
  onAuthChange,
  signOut,
  signInWithPassword,
  signUpWithPassword,
  updateFullName,
} from '../auth';

const ResponsiveAuthPanel: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ email: string | null; full_name: string | null }>({
    email: null,
    full_name: null,
  });

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const user = await getCurrentUser();
      setUserId(user?.id || null);
      setProfile(await getUserProfile());
      unsub = onAuthChange(async () => {
        const newUser = await getCurrentUser();
        setUserId(newUser?.id || null);
        setProfile(await getUserProfile());
      });
    })();
    return () => unsub();
  }, []);

  const doSignIn = async () => {
    setPending(true);
    try {
      await signInWithPassword(email.trim(), password);
      setEmail('');
      setPassword('');
    } catch (e: any) {
      alert(e.message);
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
      setEmail('');
      setPassword('');
      setFullName('');
      setMode('signin');
      alert('Account created. Please sign in.');
    } catch (e: any) {
      alert(e.message);
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
      alert(e.message);
    } finally {
      setPending(false);
    }
  };

  // --- Shared classes (mobile-first) ---
  const inputCls =
    'h-9 w-full sm:w-auto px-3 py-2 text-sm rounded-md text-black ' +
    'placeholder:text-gray-500 ' +
    'focus:outline-none focus:ring-2 focus:ring-white/60';
  const buttonCls =
    'h-9 px-3 py-2 text-sm rounded-md ' +
    'bg-white/20 text-white hover:bg-white/30 disabled:opacity-60';

  if (userId) {
    return (
      <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
        <div className="min-w-0 text-white/90 flex-1 sm:flex-none">
          {editingName ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                aria-label="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name"
                className={inputCls}
              />
              <div className="flex gap-2">
                <button onClick={doUpdateName} disabled={pending} className={buttonCls}>
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingName(false);
                    setFullName(profile.full_name || '');
                  }}
                  className={buttonCls}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <div className="font-semibold truncate">{profile.full_name || 'Unnamed User'}</div>
              <div className="text-xs opacity-90 truncate">{profile.email}</div>
              <button
                onClick={() => {
                  setFullName(profile.full_name || '');
                  setEditingName(true);
                }}
                className="bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-3 py-1 rounded-md transition mt-1 sm:mt-0"
                type="button"
              >
                Edit name
              </button>
            </div>
          )}
        </div>
        <button onClick={signOut} className={`${buttonCls} w-full sm:w-auto`} type="button">
          Sign out
        </button>
      </div>
    );
  }

  // Signed out
  return (
    <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
      {mode === 'signin' ? (
        <>
          <input
            aria-label="Email"
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <input
            aria-label="Password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          <div className="flex gap-2 sm:ml-2">
            <button onClick={doSignIn} disabled={pending} className={buttonCls} type="button">
              Sign in
            </button>
            <button
              onClick={() => setMode('signup')}
              className="underline text-white/90 text-sm px-1 py-1"
              type="button"
            >
              Create account
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            aria-label="Full name"
            type="text"
            placeholder="full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputCls}
          />
          <input
            aria-label="Email"
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <input
            aria-label="Password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          <div className="flex gap-2 sm:ml-2">
            <button onClick={doSignUp} disabled={pending} className={buttonCls} type="button">
              Sign up
            </button>
            <button
              onClick={() => setMode('signin')}
              className="underline text-white/90 text-sm px-1 py-1"
              type="button"
            >
              I have an account
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ResponsiveAuthPanel;
