import React from "react";
import ReactDOM from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  mode: "sign-in" | "sign-up";
};

export default function AuthModal({ open, onClose, mode }: Props) {
  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-lg p-6 w-full max-w-md relative">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          ✕
        </button>

        {/* Header */}
        <h2 className="text-lg font-semibold mb-4 text-center">
          {mode === "sign-in" ? "Sign In" : "Create Account"}
        </h2>

        {/* Email input */}
        <label className="block mb-2 text-sm">Email</label>
        <input
          type="email"
          placeholder="you@example.com"
          className="w-full mb-4 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800"
        />

        {/* Password input */}
        <label className="block mb-2 text-sm">Password</label>
        <input
          type="password"
          placeholder="••••••••"
          className="w-full mb-6 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800"
        />

        {/* Submit */}
        <button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 font-medium">
          {mode === "sign-in" ? "Sign In" : "Sign Up"}
        </button>
      </div>
    </div>,
    document.body
  );
}
