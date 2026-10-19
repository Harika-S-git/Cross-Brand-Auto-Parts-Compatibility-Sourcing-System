'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Loads the signed-in user; redirects to /login when absent or when role is not allowed. */
export function useUser(allowedRole) {
  const [user, setUser] = useState(null);
  const router = useRouter();
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.user) return router.replace('/login');
      if (allowedRole && d.user.role !== allowedRole) return router.replace(d.user.role === 'staff' ? '/staff' : '/');
      setUser(d.user);
    });
  }, [allowedRole, router]);
  return user;
}

export const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
